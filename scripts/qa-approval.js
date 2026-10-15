async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message) }
  let pending = false, unavailable = false, posts = 0, readFailure = false
  const spaces = ["first", "second"].map(name => ({id:`spc_${name}`, title:`Approval QA ${name}`, slug:`qa-${name}`, status:"active", disabled:false, liveUrl:`https://${name}.invalid`, liveVersionId:"ver_2"}))
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url())
    const space = spaces.find(s => s.id === url.searchParams.get("spaceId")) || spaces[0]
    const versions = [2,1].map(number => ({id:`ver_${number}`,spaceId:space.id,number,status:"ready",immutableUrl:`https://${space.slug}--v${number}.invalid`,immutableUrlStatus:"ready",createdAt:"2026-10-15T12:00:00Z",fileCount:2,totalBytes:5000,message:`Release ${number}`}))
    let body
    if (url.pathname === "/api/session") body = {connected:true,name:"Synthetic approval test",canRestore:true,pendingTickets:pending?["qa-ticket"]:[]}
    else if(url.pathname === "/api/spaces") body = {data:spaces,pagination:{hasMore:false,nextCursor:null}}
    else if(url.pathname === "/api/history") body = {space,data:versions,pagination:{hasMore:false,nextCursor:null}}
    else if(url.pathname === "/api/restore/pending") body = {tickets:pending && space.id === spaces[0].id?["qa-ticket"]:[]}
    else if(url.pathname === "/api/restore/prepare") body = {ticket:"qa-ticket",slug:spaces[0].slug,expectedLive:"ver_2",target:versions[1]}
    else if(url.pathname === "/api/restore/confirm") {pending=true;posts++;body={ticket:"qa-ticket",status:"approval_required",approvalUrl:"https://my.spacefast.com/approvals/synthetic-test"}}
    else if(url.pathname === "/api/restore/status") body = {status:unavailable?"unavailable":"pending",operationStatus:unavailable?"approval_only":"awaiting_approval",approvalUrl:unavailable?null:"https://my.spacefast.com/approvals/synthetic-test"}
    else body = {}
    if (readFailure && url.pathname === "/api/restore/status") {
      await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic status interruption.",code:"synthetic_status_error"})})
    } else await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)})
  })
  await page.goto("http://127.0.0.1:5173")
  await page.getByRole("heading",{name:"Approval QA first",exact:true}).waitFor()
  await page.locator(".version-item").filter({hasText:"Release 1"}).click()
  await page.getByRole("button",{name:"Restore version",exact:true}).click()
  await page.getByRole("textbox",{name:"Confirm Space slug"}).fill("qa-first")
  await page.getByRole("button",{name:"Confirm restore to live"}).click()
  await page.getByRole("link",{name:"Review on Spacefast"}).waitFor()
  await page.reload()
  await page.getByRole("link",{name:"Review on Spacefast"}).waitFor()
  check(await page.getByRole("button",{name:"Restore version",exact:true}).isDisabled(),"Pending restore is guarded after reload")
  await page.getByRole("button",{name:"Approval QA second",exact:true}).click()
  await page.getByRole("heading",{name:"Approval QA second",exact:true}).waitFor()
  await page.locator(".version-item").filter({hasText:"Release 1"}).click()
  await page.waitForFunction(() => !document.querySelector('.restore-bar button').disabled)
  check(await page.getByRole("link",{name:"Review on Spacefast"}).count() === 0,"Another Space's approval must not be shown")
  await page.getByRole("button",{name:"Approval QA first",exact:true}).click()
  await page.getByRole("link",{name:"Review on Spacefast"}).waitFor()
  readFailure = true
  await page.getByRole("button",{name:"Check restore status",exact:true}).click()
  await page.getByText("Synthetic status interruption.",{exact:false}).waitFor()
  readFailure = false
  unavailable = true
  await page.getByRole("button",{name:"Check restore status",exact:true}).click()
  await page.getByText("Restore unavailable: Spacefast could not complete the approved promotion",{exact:false}).waitFor()
  check(await page.getByRole("button",{name:"Restore version",exact:true}).isDisabled(),"An approval-only outcome must retain its guard")
  check(await page.getByText("Restore verified.",{exact:false}).count() === 0,"Approval is never shown as verified deployment")
  check(posts === 1,"Approval recovery never repeats the promotion")
  await page.unroute("**/api/**")
  return ["Synthetic approval UI: review link, reload recovery, per-Space isolation, explicit unavailable outcome, no false success and no repeat submission passed"]
}

async (page) => {
  const base='http://127.0.0.1:5173'
  const check=(v,m)=>{if(!v)throw new Error(m)}
  let signedIn=true, signInReturn='', versionReads=new Set()
  const linked={id:'spc_linked',title:'Shared Archive',slug:'shared-archive',status:'active',disabled:false,liveUrl:'https://shared.invalid',liveVersionId:'ver_linked_5'}
  const other={...linked,id:'spc_other',title:'Other Space',slug:'other-space',liveVersionId:'ver_other_5'}
  const version=(space,number)=>({id:`ver_${space.id==='spc_linked'?'linked':'other'}_${number}`,spaceId:space.id,number,status:'ready',immutableUrl:`https://preview-${number}.invalid`,immutableUrlStatus:'ready',createdAt:'2026-10-15T12:00:00Z',fileCount:2,totalBytes:2000,message:`Release ${number}`})
  const deep='/?space=spc_linked&version=ver_linked_1&compare=ver_linked_2&view=files'
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let body,status=200
    const s=url.searchParams.get('spaceId')==='spc_other'?other:linked
    if(url.pathname==='/api/session')body={connected:signedIn,name:'Synthetic linked account',canRestore:false}
    else if(url.pathname==='/api/spaces')body={data:[other],pagination:{hasMore:false,nextCursor:null}}
    else if(url.pathname==='/api/history')body={space:s,data:s.id===linked.id?[version(s,5)]:[version(s,5),version(s,4)],pagination:{hasMore:true,nextCursor:'older-versions'}}
    else if(url.pathname==='/api/version'){const id=url.searchParams.get('versionId');versionReads.add(id);body={data:version(s,Number(id.split('_').pop()))}}
    else if(url.pathname==='/api/restore/pending')body={tickets:[]}
    else if(url.pathname==='/api/compare'){
      const binary=url.searchParams.get('path')==='poster.png'
      body={data:{spaceId:s.id,baseDeploymentVersionId:url.searchParams.get('baseVersionId'),deploymentVersionId:url.searchParams.get('versionId'),stats:{files:2,added:1,modified:1,deleted:0},files:url.searchParams.get('cursor')?[{path:'poster.png',state:'added',before:null,after:{size:120,contentType:'image/png'}}]:[{path:'index.html',state:'modified',before:{size:12,contentType:'text/html'},after:{size:20,contentType:'text/html'}}],file:url.searchParams.get('path')?binary?{path:'poster.png',before:null,after:null,beforeReason:'not_present',afterReason:'binary'}:{path:'index.html',before:'<h1>Before</h1>\n',after:'<h1>After</h1>\n<img src=x onerror=alert(1)>\n',beforeReason:null,afterReason:null}:null,pagination:{hasMore:!url.searchParams.get('cursor'),nextCursor:url.searchParams.get('cursor')?null:'more-paths'}}}
    } else if(url.pathname==='/api/restore/activity')body={data:url.searchParams.get('cursor')?[{id:'older',spaceId:s.id,slug:s.slug,fromVersionId:'ver_linked_3',toVersionId:'ver_linked_2',state:'uncertain',operationStatus:null,createdAt:'2026-10-14T09:00:00Z',finishedAt:null}]:[{id:'verified',spaceId:s.id,slug:s.slug,fromVersionId:'ver_linked_2',toVersionId:'ver_linked_1',state:'verified',operationStatus:'succeeded',createdAt:'2026-10-15T12:00:00Z',finishedAt:null},{id:'failed',spaceId:s.id,slug:s.slug,fromVersionId:'ver_linked_1',toVersionId:'ver_linked_2',state:'failed',operationStatus:'failed',createdAt:'2026-10-15T11:00:00Z',finishedAt:'2026-10-15T11:01:00Z'}],pagination:{hasMore:!url.searchParams.get('cursor'),nextCursor:url.searchParams.get('cursor')?null:'older-activity'}}
    else if(url.pathname==='/api/auth/start'){signInReturn=new URLSearchParams(route.request().postData()).get('returnTo');status=503;body={error:'Sign-in destination checked.',code:'test_only'}}
    else {status=404;body={error:'No synthetic route.'}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  })
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(base+deep)
  await page.locator('.diff-table tr.added').first().waitFor()
  check(versionReads.has('ver_linked_1')&&versionReads.has('ver_linked_2'),'Deep link must load historical versions outside the first page')
  await page.getByRole('heading',{name:'Shared Archive',exact:true}).waitFor()
  check(new URL(page.url()).searchParams.get('version')==='ver_linked_1','Requested Space outside the initial Space page must remain selected')
  check(await page.locator('.file-text img').count()===0,'Untrusted deployed HTML must never become live markup')
  await page.getByRole('button',{name:'Load more changed files',exact:true}).click()
  await page.getByRole('button',{name:'poster.png Added',exact:false}).click()
  await page.getByText('Binary content cannot be shown as text.',{exact:true}).waitFor()
  await page.getByText('File not present in this version.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Share comparison',exact:true}).click()
  await page.getByText('The link does not grant access.',{exact:false}).waitFor()
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Synthetic unavailable clipboard')}}}))
  await page.getByRole('button',{name:'Copy comparison link',exact:true}).click()
  await page.getByText('Clipboard unavailable.',{exact:false}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Restore activity',exact:true}).click()
  await page.getByText('Verified live',{exact:true}).waitFor()
  await page.getByText('Completion time unavailable for this earlier record.',{exact:true}).waitFor()
  await page.getByRole('dialog',{name:'Restore activity',exact:true}).getByText('Failed',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Load earlier activity',exact:true}).click()
  await page.getByText('Outcome unverified',{exact:true}).waitFor()
  check(await page.locator('.activity-list li').count()===3,'Activity paging must retain all rows')
  await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
  const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))
  check(!violations.length,'Activity accessibility: '+JSON.stringify(violations))
  await page.screenshot({path:'artifacts/restore-activity.png'})
  await page.keyboard.press('Escape')
  signedIn=false
  await page.goto(base+deep)
  await page.getByText('Connect Spacefast to open this shared comparison.',{exact:false}).waitFor()
  await page.getByRole('button',{name:'Connect Spacefast',exact:true}).first().click()
  await page.getByRole('button',{name:'Continue to Spacefast',exact:true}).click()
  await page.getByText('Sign-in destination checked.',{exact:true}).waitFor()
  check(signInReturn===deep,'OAuth start must retain the private comparison destination')
  await page.unroute('**/api/**')
  await page.goto(base)
  return ['Synthetic linked account: exact historical pair outside list pages, served-file paging, binary reasons, escaped content, private share warning, clipboard fallback, durable activity paging, and OAuth destination passed','Restore activity: zero automated WCAG AA violations']
}

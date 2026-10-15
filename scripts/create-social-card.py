"""Render a deterministic 1200 x 630 card from an actual public-demo capture."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
S = 2
def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf', size*S)

im = Image.new('RGB', (1200*S, 630*S), '#121c23')
d = ImageDraw.Draw(im)
def text(x,y,s,size,color,bold=False):
    d.text((x*S,y*S),s,font=font(size,bold),fill=color)

d.rounded_rectangle((56*S,48*S,97*S,89*S),radius=12*S,fill='#c8eea5')
d.arc((65*S,58*S,87*S,80*S),-90,230,fill='#203228',width=3*S)
d.line([(64*S,58*S),(64*S,67*S),(73*S,67*S)],fill='#203228',width=3*S)
text(111,49,'spacefast',25,'#f1f4f6',True)
text(58,112,'T I M E   M A C H I N E',11,'#b6c6ce')
text(56,184,'Every version.',54,'#f4f7f8',True)
text(56,250,'Within reach.',54,'#c8eea5',True)
text(59,335,'Compare. Inspect. Restore.',22,'#d4dee3')
text(59,376,'A little perspective on your past.',16,'#a9bdc7')

capture=ROOT/'artifacts/walkthrough-compare.png'
if not capture.exists():
    capture=ROOT/'docs/images/comparison.jpg'
shot=Image.open(capture).convert('RGB')
# Show real version previews, without borrowing interface state from a mock.
shot=shot.crop((648,449,1562,1000))
shot=shot.resize((602*S,418*S),Image.Resampling.LANCZOS)
mask=Image.new('L',shot.size,0)
ImageDraw.Draw(mask).rounded_rectangle((0,0,shot.width,shot.height),radius=16*S,fill=255)
shadow=Image.new('RGBA',im.size,(0,0,0,0))
ImageDraw.Draw(shadow).rounded_rectangle((557*S,140*S,1159*S,558*S),radius=20*S,fill=(0,0,0,140))
shadow=shadow.filter(ImageFilter.GaussianBlur(20*S))
im=Image.alpha_composite(im.convert('RGBA'),shadow)
im.paste(shot,(552*S,130*S),mask)
d=ImageDraw.Draw(im)
d.line((58*S,557*S,499*S,557*S),fill='#354550',width=1*S)
text(59,581,'OPEN SOURCE  /  HOSTED ON SPACEFAST',12,'#b5c9b7')
im.convert('RGB').resize((1200,630),Image.Resampling.LANCZOS).save(ROOT/'public/social-card.png',optimize=True)

images=ROOT/'docs/images'
images.mkdir(parents=True,exist_ok=True)
for source,target in [('walkthrough-compare.png','comparison.jpg'),('walkthrough-files.png','file-diff.jpg')]:
    if (ROOT/'artifacts'/source).exists():
        Image.open(ROOT/'artifacts'/source).convert('RGB').save(images/target,quality=88,optimize=True)
print('Rendered social card and real public-demo README screenshots.')

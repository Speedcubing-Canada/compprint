# Builds src/pdf/fonts/scorecard-sans-*.otf from TeX Gyre Heros 2.004 (GUST Font License):
#   curl -LO https://www.gust.org.pl/projects/e-foundry/tex-gyre/heros/qhv2.004otf.zip && unzip qhv2.004otf.zip
#   python3 scripts/makeScorecardSans.py <dir with texgyreheros-*.otf>
# Renamed because the license asks modified fonts not to reuse the original name.
import sys
from fontTools.ttLib import TTFont

src_dir = sys.argv[1]
for style, sub in (('regular', 'Regular'), ('bold', 'Bold')):
    f = TTFont(f'{src_dir}/texgyreheros-{style}.otf')
    # react-pdf lays out built-in Helvetica with ascent 900 / descent -200; Heros' taller
    # line box drops text from fixed-height rows (first-timer slips).
    f['hhea'].ascent, f['hhea'].descent, f['hhea'].lineGap = 900, -200, 0
    os2 = f['OS/2']
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = 900, -200, 0
    os2.usWinAscent, os2.usWinDescent = 900, 200
    ps = f'ScorecardSans-{sub}'
    for n in f['name'].names:
        if n.nameID in (1, 16): n.string = 'Scorecard Sans'
        elif n.nameID == 4: n.string = f'Scorecard Sans {sub}'
        elif n.nameID == 3: n.string = f'{ps}; based on TeX Gyre Heros 2.004'
        elif n.nameID == 6: n.string = ps
    f['CFF '].cff.fontNames = [ps]
    f.save(f'src/pdf/fonts/scorecard-sans-{style}.otf')

/* ==========================================================================
   FROGGER  ::  sprites.js
   --------------------------------------------------------------------------
   THE PIXEL ART. Every picture in the arcade theme is in this file, drawn as
   a grid of letters. One letter is one pixel.

   To change a picture, change the letters. That is the whole trick.

       '....GGGG....'      G is bright green
       '...GGGGGG...'      . is transparent (you see the water through it)
       '...GWKKWG...'      W is white, K is black

   The letters are listed in PALETTE below, so you can look up what each one
   means, and change what colour a letter is (make every G purple and the
   whole game changes).

   Rules:
     - every row of a sprite must be the SAME LENGTH, or it will look wrong
     - a sprite can be any size, but 16 x 16 keeps them all consistent
     - '.' means "leave this pixel see-through"

   These are drawn from scratch to look like the 1981 cabinet. They are not
   Konami's original art.
   ========================================================================== */


/* --------------------------------------------------------------------------
   The colours. Change a value here and every sprite using that letter
   changes with it.
   -------------------------------------------------------------------------- */
const PALETTE = {
  '.': null,          /* transparent */

  K: '#000000',       /* black: tyres, outlines, eyes */
  W: '#ffffff',       /* white: truck bodies, teeth */
  w: '#b8b8b8',       /* light grey: panel edges */
  s: '#606060',       /* dark grey: shadow */
  C: '#00b8f8',       /* cyan: windscreens */

  G: '#00e000',       /* bright green: the frog */
  g: '#00a800',       /* mid green: frog shading, crocodiles */
  d: '#006000',       /* dark green: outlines, lilypads */
  y: '#a8e000',       /* lime: snakes */
  J: '#5c9c00',       /* olive: crocodiles, so the green frog stands out on one */
  j: '#2c5000',       /* dark olive: crocodile outlines */

  Y: '#f8d800',       /* yellow: taxis, bulldozer blade */
  O: '#f87800',       /* orange */
  R: '#f83800',       /* red-orange: turtle shells */
  r: '#a82000',       /* dark red: shell edges */

  P: '#f800c0',       /* magenta: the pink cars, the lady frog */
  p: '#a00080',       /* dark magenta */

  B: '#a86028',       /* log brown */
  b: '#703818',       /* log dark brown */
  n: '#c88848',       /* log tan, the cut ends */

};


/* --------------------------------------------------------------------------
   Two small helpers, used at the bottom of the file so we do not have to
   draw the same thing twice.
   -------------------------------------------------------------------------- */

/* Flip a sprite left to right. */
function mirrorSprite(rows) {
  return rows.map((row) => row.split('').reverse().join(''));
}

/* Swap one set of letters for another, e.g. turn the green frog pink. */
function recolorSprite(rows, swaps) {
  return rows.map((row) =>
    row.split('').map((ch) => (swaps[ch] !== undefined ? swaps[ch] : ch)).join('')
  );
}


/* ==========================================================================
   THE SPRITES
   ========================================================================== */

const SPRITES = {

  /* ---------------------------------------------------------------- the frog
     Facing up the screen: two eyes on top, four legs splayed out. */
  frog: [
    '................',
    '..gg........gg..',
    '..gGg......gGg..',
    '..gGGWW..WWGGg..',
    '..gGGWK..KWGGg..',
    '..gGGGGGGGGGGg..',
    '.gGGGGGGGGGGGGg.',
    'gGGGGGGGGGGGGGGg',
    'gGGGGGGGGGGGGGGg',
    '.gGGGGGGGGGGGGg.',
    '..gGGGGGGGGGGg..',
    '..gGg.GGGG.gGg..',
    '.gGg..GGGG..gGg.',
    '.gg....GG....gg.',
    '................',
    '................',
  ],

  /* A frog sitting safe in a lilypad. Tucked in, legs pulled under. */
  frogHome: [
    '................',
    '................',
    '....dddddddd....',
    '..ddgggggggddd..',
    '.ddgGGWWWWGGgdd.',
    '.dggGWKWWKWGggd.',
    '.dgGGGGGGGGGGgd.',
    '.dgGGGGGGGGGGgd.',
    '.dgGGGGGGGGGGgd.',
    '.dggGGGGGGGGggd.',
    '..ddgggggggddd..',
    '....dddddddd....',
    '................',
    '................',
    '................',
    '................',
  ],

  /* ------------------------------------------------------------ the lilypad
     An empty home, waiting. */
  lilypad: [
    '................',
    '................',
    '.....dddddd.....',
    '...dddddddddd...',
    '..ddggggggggdd..',
    '.ddgggggggggddd.',
    '.dggggggggggggd.',
    '.dggggggggggggd.',
    '.dggggggggggggd.',
    '.dggggggggggggd.',
    '.ddgggggggggddd.',
    '..ddggggggggdd..',
    '...dddddddddd...',
    '.....dddddd.....',
    '................',
    '................',
  ],

  /* ----------------------------------------------------------------- the fly
     Worth 200 if you land on the lilypad it is sitting in. */
  fly: [
    '................',
    '..w..........w..',
    '.www........www.',
    '.wwww......wwww.',
    '..wwww....wwww..',
    '...wwwKKKKwww...',
    '.....KKKKKK.....',
    '....KRKKKKRK....',
    '....KKKKKKKK....',
    '.....KKKKKK.....',
    '......KKKK......',
    '.......KK.......',
    '................',
    '................',
    '................',
    '................',
  ],

  /* ---------------------------------------------------- crocodile in a bay
     Lurking in a lilypad. Jumping in while its jaws are up kills you. */
  bayCroc: [
    '................',
    '..jj........jj..',
    '.jJKJj....jJKJj.',
    '.jJJJj....jJJJj.',
    '.jJJJJjjjjjJJJj.',
    '..jJJJJJJJJJJj..',
    '..jJJJJJJJJJJJj.',
    '..jWWWWWWWWWWWj.',
    '..jKKKKKKKKKKKj.',
    '..jWWWWWWWWWWWj.',
    '..jJJJJJJJJJJJj.',
    '...jjjjjjjjjjj..',
    '................',
    '................',
    '................',
    '................',
  ],

  /* --------------------------------------------------------------- the splat
     What is left of you. */
  splat: [
    '................',
    '......W..W......',
    '..W...WWWW...W..',
    '...W..WRRW..W...',
    '....WWRRRRWW....',
    '..W.WRRRRRRW.W..',
    '.WWWRRRRRRRRWWW.',
    '..WRRRRRRRRRRW..',
    '..WRRRRRRRRRRW..',
    '.WWWRRRRRRRRWWW.',
    '..W.WRRRRRRW.W..',
    '....WWRRRRWW....',
    '...W..WRRW..W...',
    '..W...WWWW...W..',
    '......W..W......',
    '................',
  ],

  /* ---------------------------------------------------------------- the logs
     Three pieces: a rounded left end with the grain of the cut showing, a
     middle that tiles as long as the log needs to be, and a right end. */
  logLeft: [
    '................',
    '................',
    '...bbbbbbbbbbbbb',
    '..bnnnnnnnnnnnnn',
    '.bnBBBBBBBBBBBBB',
    'bnBBnnBBBBBBBBBB',
    'bnBnBBnbbbbbbbbb',
    'bnBnBBnBBBBBBBBB',
    'bnBnBBnBBBBBBBBB',
    'bnBBnnBnnnnnnnnn',
    'bnBBBBBBBBBBBBBB',
    '.bnBBBBBBBBBBbbb',
    '..bbnnnnnnnnnBBB',
    '...bbbbbbbbbbbbb',
    '................',
    '................',
  ],

  logMid: [
    '................',
    '................',
    'bbbbbbbbbbbbbbbb',
    'nnnnnnnnnnnnnnnn',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'bbbbbbbbbbbbbbbb',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'nnnnnnnnnnnnnnnn',
    'BBBBBBBBBBBBBBBB',
    'bbbbbbbbbbbbbbbb',
    'BBBBBBBBBBBBBBBB',
    'bbbbbbbbbbbbbbbb',
    '................',
    '................',
  ],

  /* -------------------------------------------------------------- the turtle
     Red-orange shell, green head poking out of the left. A group of three
     is just this drawn three times. */
  turtle: [
    '................',
    '.......rrrrrr...',
    '.....rrRRRRRRr..',
    '....rRRRRRRRRRr.',
    '..g.rROORROORRr.',
    '.gggrRRRRRRRRRr.',
    'gKggrRRRRRRRRRr.',
    'gKggrROORROORRr.',
    '.gggrRRRRRRRRRr.',
    '..g.rRRRRRRRRRr.',
    '....rRRRRRRRRr..',
    '.....rrRRRRrr...',
    '...g..rrrrrr..g.',
    '..gg........gg..',
    '................',
    '................',
  ],

  /* ----------------------------------------------------------- the crocodile
     Rides the river like a log. The body is safe. The head is not.
     Three pieces again: tail, body, head. */
  gatorTail: [
    '................',
    '................',
    '.........jjjjjjj',
    '......jjjJJJJJJJ',
    '....jjJJJJJJJJJJ',
    '..jjJjJjJjJjJjJj',
    '.jJJJJJJJJJJJJJJ',
    'jjJJJJJJJJJJJJJJ',
    'jjJJJJJJJJJJJJJJ',
    '.jJJJJJJJJJJJJJJ',
    '..jjJjJjJjJjJjJj',
    '....jjJJJJJJJJJJ',
    '......jjjJJJJJJJ',
    '.........jjjjjjj',
    '................',
    '................',
  ],

  gatorBody: [
    '................',
    '................',
    'jjjjjjjjjjjjjjjj',
    'JJJJJJJJJJJJJJJJ',
    'JJJJJJJJJJJJJJJJ',
    'jJjJjJjJjJjJjJjJ',
    'JJJJJJJJJJJJJJJJ',
    'JJJJJJJJJJJJJJJJ',
    'JJJJJJJJJJJJJJJJ',
    'JJJJJJJJJJJJJJJJ',
    'jJjJjJjJjJjJjJjJ',
    'JJJJJJJJJJJJJJJJ',
    'JJJJJJJJJJJJJJJJ',
    'jjjjjjjjjjjjjjjj',
    '................',
    '................',
  ],

  gatorHead: [
    '................',
    '................',
    'jjjjjjj.........',
    'JJJJJJJjj.......',
    'JKWJJJJJJjj.....',
    'JWJJJJJJJJWjj...',
    'jJJJJJJWWWWWjj..',
    'JJJJJJWWWWWWWjj.',
    'JJJJJJWWWWWWWjj.',
    'jJJJJJJWWWWWjj..',
    'JWJJJJJJJJWjj...',
    'JKWJJJJJJjj.....',
    'JJJJJJJjj.......',
    'jjjjjjj.........',
    '................',
    '................',
  ],

  /* The same head with the jaws open. Ride the back of a crocodile all you
     like; the head is only a square while the mouth is shut. */
  gatorJaws: [
    'jjjjjjj.........',
    'JJJJJJJjj.......',
    'JKWJJJJJJjj.....',
    'JWJJJJJJJJWjj...',
    'jJJJJJJWWWWWjj..',
    'JJJJJJWWWWWWWjj.',
    'JJJJJ...........',
    'JJJJ............',
    'JJJJ............',
    'JJJJJ...........',
    'JJJJJJWWWWWWWjj.',
    'jJJJJJJWWWWWjj..',
    'JWJJJJJJJJWjj...',
    'JKWJJJJJJjj.....',
    'JJJJJJJjj.......',
    'jjjjjjj.........',
  ],

  /* A pocket of breathable air, for the levels that have none. */
  airPocket: [
    '................',
    '.....CCCCCC.....',
    '...CCCCCCCCCC...',
    '..CCWWCCCCCCCC..',
    '.CCWWWCCCCCCCCC.',
    '.CCWWCCCCCCCCCC.',
    'CCCWCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    'CCCCCCCCCCCCCCCC',
    '.CCCCCCCCCCCCCC.',
    '.CCCCCCCCCCCCCC.',
    '..CCCCCCCCCCCC..',
    '...CCCCCCCCCC...',
    '.....CCCCCC.....',
    '................',
  ],

  /* -------------------------------------------------------------- the snakes
     They patrol the median from level 3, which takes the safety away from
     the one row that used to have it. */
  snakeHead: [
    '................',
    '................',
    '................',
    '.....dddd.......',
    '...ddyyydd......',
    '..dyyKyyyydddddd',
    '.Rdyyyyyyyyyyyyy',
    'RRdyyyyyyyyyyyyy',
    'RRdyyyyyyyyyyyyy',
    '.Rdyyyyyyyyyyyyy',
    '..dyyKyyyydddddd',
    '...ddyyydd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
  ],

  snakeBody: [
    '................',
    '................',
    '................',
    '................',
    '................',
    'dddddddddddddddd',
    'yyyyyyyyyyyyyyyy',
    'yyKKyyyyKKyyyyKK',
    'yyKKyyyyKKyyyyKK',
    'yyyyyyyyyyyyyyyy',
    'dddddddddddddddd',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],

  snakeTail: [
    '................',
    '................',
    '................',
    '................',
    '................',
    'ddddddddddd.....',
    'yyyyyyyyyydd....',
    'yyKKyyyyyyydd...',
    'yyKKyyyyyyyydd..',
    'yyyyyyyyyyyyydd.',
    'ddddddddddddddd.',
    '..............d.',
    '................',
    '................',
    '................',
    '................',
  ],

  /* --------------------------------------------------------------- the truck
     Two pieces so the trailer can be any length. */
  truckBack: [
    '................',
    '................',
    '................',
    'WWWWWWWWWWWWWWWW',
    'WwWWWWWwWWWWWwWW',
    'WwWWWWWwWWWWWwWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WwWWWWWwWWWWWwWW',
    'WwWWWWWwWWWWWwWW',
    'WWWWWWWWWWWWWWWW',
    '..ssss....ssss..',
    '..sKKs....sKKs..',
    '..ssss....ssss..',
    '................',
    '................',
  ],

  truckCab: [
    '................',
    '................',
    '................',
    'WWWWWWWWWWW.....',
    'WWWWWWWWWWWWW...',
    'WWWWWWWWWWCCCW..',
    'WWWWWWWWWWCCCWW.',
    'WWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWW.',
    '..ssss...ssss...',
    '..sKKs...sKKs...',
    '..ssss...ssss...',
    '................',
    '................',
  ],

  /* ----------------------------------------------------- the racing car
     The fast one. Blink and it is gone. */
  racer: [
    '................',
    '................',
    '................',
    '................',
    '....WW..........',
    '...WWWWW........',
    'WWWWWWWWWWWW....',
    'WWWWWCCWWWWWWWY.',
    'WWWWWWWWWWWWWWYY',
    'WWWWWWWWWWWWWWY.',
    '.WWWWWWWWWWWW...',
    '.ssss....ssss...',
    '.sKKs....sKKs...',
    '.ssss....ssss...',
    '................',
    '................',
  ],

  /* ----------------------------------------------------------- the pink car */
  car: [
    '................',
    '................',
    '................',
    '.....PPPPPP.....',
    '....PCCCCCCP....',
    '...PPCCCCCCPP...',
    '.PPPPPPPPPPPPPP.',
    'PPPPPPPPPPPPPPPP',
    'PPPPPPPPPPPPPPPP',
    'PPPPPPPPPPPPPPPP',
    '.PPPPPPPPPPPPPP.',
    '..ssss....ssss..',
    '..sKKs....sKKs..',
    '..ssss....ssss..',
    '................',
    '................',
  ],

  /* ---------------------------------------------------------- the bulldozer */
  dozer: [
    '................',
    '................',
    '................',
    '...GGGGGG.......',
    '..GCCCCCCG..YY..',
    '..GCCCCCCG..YY..',
    'GGGGGGGGGGG.YY..',
    'GGGGGGGGGGGGYY..',
    'GGGGGGGGGGGGYYY.',
    'GGGGGGGGGGGGYYY.',
    'sssssssssssssss.',
    'sKsKsKsKsKsKsss.',
    'sssssssssssssss.',
    '................',
    '................',
    '................',
  ],

  /* ---------------------------------------------------------------- the taxi */
  taxi: [
    '................',
    '................',
    '......KKKK......',
    '.....YYYYYY.....',
    '....YCCCCCCY....',
    '...YYCCCCCCYY...',
    '.YYYYYYYYYYYYYY.',
    'YYYYYYYYYYYYYYYY',
    'YKYKYKYKYKYKYKYK',
    'YYYYYYYYYYYYYYYY',
    '.YYYYYYYYYYYYYY.',
    '..ssss....ssss..',
    '..sKKs....sKKs..',
    '..ssss....ssss..',
    '................',
    '................',
  ],

  /* ------------------------------------------------- the monster truck
     For the bonus round. Seen from above, with the frog at the wheel. Grey
     tyres rather than black ones, because the road it drives on is black. */
  monsterTruck: [
    '................',
    '.ssss......ssss.',
    '.sKKs......sKKs.',
    '.ssss......ssss.',
    '..RRRRRRRRRRRR..',
    '.RRRRRRRRRRRRRR.',
    '.RRGGGGGGGGGGRR.',
    '.RRGWWGGGGWWGRR.',
    '.RRGWKGGGGKWGRR.',
    '.RRGGGGGGGGGGRR.',
    '.RRRRRRRRRRRRRR.',
    '..RRRRRRRRRRRR..',
    '.ssss......ssss.',
    '.sKKs......sKKs.',
    '.ssss......ssss.',
    '................',
  ],

  /* A little boat. The river fills up with these during the bonus round,
     because ramming boats is more fun than ramming logs. */
  boat: [
    '................',
    '.......W........',
    '.......WW.......',
    '......WWWW......',
    '.....WWWWWW.....',
    '....WWWWWWWW....',
    '.......WW.......',
    '.......WW.......',
    '..nnnnnnnnnnnn..',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '..BBBBBBBBBBBB..',
    '...bbbbbbbbbb...',
    '................',
    '................',
    '................',
  ],

  /* iceFloe */
  iceFloe: [
    '................',
    '................',
    '..WWWWWWWWWWWW..',
    '.WWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWWW',
    'WWWWwWWWWWWwWWWW',
    'WWWWwWWWWWWwWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWwWWWWWWWWwWWW',
    'WWWwWWWWWWWWwWWW',
    'WWWWWWWWWWWWWWWW',
    '.WWWWWWWWWWWWWW.',
    '..WWWWWWWWWWWW..',
    '................',
    '................',
  ],

  /* asteroid */
  asteroid: [
    '................',
    '................',
    '...ssssssssss...',
    '..sswwwwwwwwss..',
    '.swwwwsswwwwwwws',
    'swwwwwsswwwwwwww',
    'swwsswwwwwwsswww',
    'swwsswwwwwwsswww',
    'swwwwwwwwwwwwwww',
    'swwwwwwsswwwwwww',
    'swwwwwwsswwwwwww',
    '.swwwwwwwwwwwws.',
    '..sswwwwwwwwss..',
    '...ssssssssss...',
    '................',
    '................',
  ],

  /* ufo */
  ufo: [
    '................',
    '................',
    '.....CCCCCC.....',
    '....CWWWWWWC....',
    '...CWWCCCCWWC...',
    '...CWCCCCCCWC...',
    '..sssssssssss...',
    '.sswwwwwwwwwss..',
    'sswwwwwwwwwwwwss',
    '.sswwwwwwwwwss..',
    '..sssssssssss...',
    '....C..CC..C....',
    '................',
    '................',
    '................',
    '................',
  ],

  /* rocket */
  rocket: [
    '................',
    '.......WW.......',
    '......WWWW......',
    '......WRRW......',
    '.....WWRRWW.....',
    '.....WWWWWW.....',
    '....WWWWWWWW....',
    '....WWCCCCWW....',
    '....WWCCCCWW....',
    '...WWWWWWWWWW...',
    '..RWWWWWWWWWWR..',
    '.RRWWWWWWWWWWRR.',
    'RRR.WWWWWWWW.RRR',
    '.....YYYYYY.....',
    '......YOOY......',
    '.......OO.......',
  ],

  /* helicopter */
  helicopter: [
    '................',
    '..sssssssssss...',
    '.......ss.......',
    '.......ss.......',
    '....RRRRRRRR....',
    '...RRRRRRRRRR...',
    '..RRGGGGGGGGRR..',
    '..RRGWWGGWWGRR..',
    '..RRGWKGGKWGRR..',
    '..RRRRRRRRRRRR..',
    '...RRRRRRRRRs...',
    '....RRRRRRsss...',
    '.....RRRR..sss..',
    '..ss.ss.ss......',
    '................',
    '................',
  ],

  /* bullet */
  bullet: [
    '................',
    '................',
    '................',
    '.......YY.......',
    '......YWWY......',
    '......YWWY......',
    '......YWWY......',
    '.......YY.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],

  /* ghost */
  ghost: [
    '................',
    '.....WWWWWW.....',
    '...WWWWWWWWWW...',
    '..WWWWWWWWWWWW..',
    '..WWKKWWWWKKWW..',
    '..WWKKWWWWKKWW..',
    '.WWWWWWWWWWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '.WWWWWKKKKWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '.WWWWWWWWWWWWWW.',
    '.WW.WW.WW.WW.WW.',
    '..W..W..W..W..W.',
    '................',
  ],

  /* gravestone */
  gravestone: [
    '................',
    '.....wwwwww.....',
    '....wwwwwwww....',
    '...wwwwwwwwww...',
    '...wwsssswwsww..',
    '...wwswwsswsww..',
    '...wwsswwsssww..',
    '...wwwwwwwwwww..',
    '...wwsssssswww..',
    '...wwwwwwwwwww..',
    '...wwwwwwwwwww..',
    '...wwwwwwwwwww..',
    '..wwwwwwwwwwwww.',
    '.wwwwwwwwwwwwww.',
    'wwwwwwwwwwwwwwww',
    '................',
  ],
  /* A star to grab on the way up during the rocket level. */
  star: [
    '................',
    '.......YY.......',
    '.......YY.......',
    '......YWWY......',
    '......YWWY......',
    '.YYYYYYWWYYYYYY.',
    '.YWWWWWWWWWWWWY.',
    '..YWWWWWWWWWWY..',
    '...YYWWWWWWYY...',
    '.....YWWWWY.....',
    '....YWWYYWWY....',
    '...YWWY..YWWY...',
    '..YWY......YWY..',
    '..YY........YY..',
    '................',
    '................',
  ],
  /* Alien attackers for the helicopter level. */
  alien: [
    '................',
    '..K..........K..',
    '..KK........KK..',
    '...KKK....KKK...',
    '....PPPPPPPP....',
    '...PPPPPPPPPP...',
    '..PPKKPPPPKKPP..',
    '..PPKKPPPPKKPP..',
    '..PPPPPPPPPPPP..',
    '...PPPPPPPPPP...',
    '....PPPPPPPP....',
    '...pp.pppp.pp...',
    '..pp...pp...pp..',
    '..p.........p...',
    '................',
    '................',
  ],

  /* What the aliens shoot back with. */
  enemyShot: [
    '................',
    '................',
    '................',
    '................',
    '......PPPP......',
    '.....PWWWWP.....',
    '.....PWWWWP.....',
    '......PPPP......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};


/* --------------------------------------------------------------------------
   Sprites built from other sprites, so there is only one copy to edit.
   -------------------------------------------------------------------------- */

/* The right hand end of a log is the left hand end, backwards. */
SPRITES.logRight = mirrorSprite(SPRITES.logLeft);

/* The lady frog is the frog, in pink. */
SPRITES.lady = recolorSprite(SPRITES.frog, { G: 'P', g: 'p', d: 'p' });

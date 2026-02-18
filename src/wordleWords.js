'use strict';
const fs = require('fs');

// ~300 common, familiar 6-letter words used as answers
const ANSWER_WORDS = [
  // Nature / environment
  'autumn','bridge','canopy','canyon','castle','clouds','desert',
  'forest','frozen','garden','harbor','island','jungle','lagoon',
  'marble','meadow','nature','oyster','pebble','pillar','planet',
  'puddle','rivers','shores','stream','summer','sunset','timber',
  'tunnel','valley','walrus','waters','winter','breeze','spring',
  // Food / drink
  'almond','banana','biscuit','butter','carrot','celery','cherry',
  'coffee','cookie','fondue','garlic','ginger','grapes','lentil',
  'muffin','noodle','nutmeg','orange','papaya','pastry','peanut',
  'pepper','pickle','potato','radish','raisin','salmon','sesame',
  'shrimp','sorbet','squash','toffee','tomato','turnip','waffle',
  'walnut','yogurt','cloves','syrupy','musket',
  // Animals
  'badger','canary','donkey','falcon','ferret','gibbon','jaguar',
  'lizard','monkey','parrot','rabbit','spider','toucan','turtle',
  'weasel','condor','coyote','darter','gannet','gopher','iguana',
  'impala','magpie','marmot','minnow','moose','narwhal','otter',
  // People / roles
  'author','dancer','doctor','farmer','hunter','junior','knight',
  'leader','master','mother','parent','person','player','prince',
  'sister','singer','wizard','artist','archer','banker','bishop',
  'bowler','butler','censor','clergy','consul','corpse','cousin',
  'critic','driver','editor','ensign','fisher','foster','grocer',
  'helper','hermit','jester','jockey','keeper','lancer','lawyer',
  'linker','looker','maiden','mentor','miller','mister','mystic',
  'nephew','nester','outlaw','pauper','pigeon','pirate','porter',
  'potter','ranger','rascal','reader','reaper','sailor','savant',
  'scribe','seeker','seller','senior','sherif','skater','slayer',
  'smoker','solver','squire','surfer','tailor','tenant','trader',
  'tycoon','usher','vendor','victor','viewer','walker','warder',
  'weaver','worker','writer',
  // Places
  'castle','center','chapel','cinema','circus','clinic','closet',
  'colony','corner','county','empire','estate','garage','ghetto',
  'hamlet','hangar','harbor','hostel','kennel','locker','market',
  'mosque','museum','office','palace','prison','resort','school',
  'senate','shrine','stable','street','studio','suburb','temple',
  'market','tunnel','turret','valley','village',
  // Objects / things
  'anchor','basket','bottle','button','candle','carpet','crayon',
  'cursor','dagger','device','dollar','emblem','eraser','faucet',
  'filter','folder','fossil','gadget','goblet','hammer','helmet',
  'jersey','kettle','ladder','locket','magnet','mirror','module',
  'needle','pencil','pillow','pocket','podium','poster','puppet',
  'puzzle','quiver','ribbon','rocket','saddle','sandal','saucer',
  'scroll','shield','socket','sponge','statue','stitch','stove',
  'switch','symbol','tablet','teapot','thatch','thread','ticket',
  'timber','tinder','tinsel','tissue','toggle','tongue','trophy',
  'trowel','turban','vessel','violin','wallet','warden','window',
  'zipper',
  // Abstract / other
  'accent','access','action','agenda','amount','annual','budget',
  'chance','change','charge','choice','chorus','custom','damage',
  'danger','decade','detail','effort','energy','engine','factor',
  'family','flight','future','growth','health','income','injury',
  'intent','lesson','method','minute','moment','motion','muscle',
  'notion','option','output','phrase','profit','record','report',
  'rescue','result','return','reward','rights','sample','scheme',
  'season','secret','series','signal','simple','single','source',
  'spirit','spread','status','strain','stress','strike','string',
  'stroke','supply','system','target','theory','threat','timing',
  'update','vertex','vision','winner',
  // Colors / descriptors
  'auburn','bisque','cobalt','copper','coral','cream','crimson',
  'fallow','indigo','lemon','maroon','navajo','ochre','sienna',
  'silver','umber','violet','yellow',
  // Common adjective-roots used as nouns
  'bitter','broken','casual','clever','common','double','famous',
  'frozen','gentle','golden','humble','little','lovely','narrow',
  'normal','pretty','remote','robust','sturdy','sudden','tender',
  'triple','unique','varied','wicked',
].filter((w, i, a) =>
  /^[a-z]{6}$/.test(w) && a.indexOf(w) === i   // exactly 6 letters, deduplicated
);

// Load full dictionary for guess validation; fall back to ANSWER_WORDS
function loadValidWords() {
  try {
    const words = fs.readFileSync('/usr/share/dict/words', 'utf8')
      .split('\n')
      .filter(w => /^[a-z]{6}$/.test(w));
    console.log(`[wordle] Loaded ${ANSWER_WORDS.length} answer words, ${words.length} valid guesses`);
    return new Set(words);
  } catch {
    console.log(`[wordle] Loaded ${ANSWER_WORDS.length} answer words, dict unavailable – using answer list as fallback`);
    return new Set(ANSWER_WORDS);
  }
}

const VALID_WORDS = loadValidWords();

function pickSecretWord() {
  return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
}

function isValidGuess(word) {
  return VALID_WORDS.has(word.toLowerCase());
}

module.exports = { pickSecretWord, isValidGuess, ANSWER_WORDS };

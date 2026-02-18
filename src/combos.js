const fs = require('fs');

const COMBOS_2 = [
  'TR', 'ST', 'OU', 'AN', 'IN', 'RE', 'ER', 'EN',
  'NG', 'ON', 'AT', 'OR', 'IT', 'AL', 'AR', 'UN', 'CH', 'SH',
  'TH', 'PL', 'BR', 'CR', 'DR', 'FL', 'FR', 'GR', 'PR', 'SP',
  'BL', 'CL', 'GL', 'NT', 'ND', 'LY', 'CK', 'OW', 'OI', 'EA',
  'OO', 'AY', 'AI', 'EE', 'AU', 'LL', 'SS',
];

const COMBOS_3 = [
  'ING', 'STR', 'OUN', 'PRE', 'COM', 'CON',
  'TER', 'ION', 'ATE', 'OUS', 'ENT', 'MEN', 'TED', 'PRO',
];

// Load system dictionary (macOS/Linux: /usr/share/dict/words)
// Falls back to a small built-in set if unavailable.
function _loadWordSet() {
  const DICT_PATH = '/usr/share/dict/words';
  try {
    const words = fs.readFileSync(DICT_PATH, 'utf8')
      .split('\n')
      .filter(w => /^[a-z]{2,}$/.test(w)); // lowercase, letters only, min length 2
    console.log(`[combos] Loaded ${words.length} words from ${DICT_PATH}`);
    return new Set(words);
  } catch {
    console.warn('[combos] System dictionary not found, using built-in fallback');
    return new Set([
      'able','about','above','across','act','action','add','after','again','age',
  'ago','ahead','air','all','allow','along','also','although','always','among',
  'ancient','and','animal','another','answer','any','appear','area','arm','army',
  'around','art','ask','at','attack','away',
  // B
  'back','ball','band','base','battle','be','bear','beat','become','before',
  'begin','behind','believe','best','better','between','big','bird','black',
  'blast','blend','block','blood','blow','blue','boat','body','bone','book',
  'boom','born','both','bottom','brain','brave','bread','break','bridge',
  'bring','broad','broke','broken','brother','brown','build','burn','bush',
  // C
  'call','came','can','care','carry','catch','cause','center','century','change',
  'charge','check','child','choose','city','claim','class','clean','clear',
  'climb','clock','close','cloud','club','coal','coast','coin','cold','come',
  'common','complete','connect','control','cool','corn','could','count','country',
  'cover','crack','create','cross','crowd','cry','culture','cut',
  // D
  'dark','date','day','dead','deal','deep','defend','design','develop','different',
  'direct','discover','distance','does','done','door','down','draw','dream',
  'drive','drop','dry','during',
  // E
  'each','early','earth','east','easy','edge','eight','else','end','enemy',
  'enough','enter','equal','even','event','every','evil','example','eye',
  // F
  'face','fact','fall','family','far','fast','feel','field','fight','fill',
  'final','find','fire','first','fish','flat','floor','flow','flower','fly',
  'follow','food','force','form','found','four','free','fresh','friend','from',
  'front','fruit','full','further',
  // G
  'game','general','get','give','glass','glory','goal','gold','good','grass',
  'great','green','ground','group','grow','guard','guide',
  // H
  'hand','happen','hard','have','head','hear','heart','heat','help','here',
  'high','hill','history','hold','home','honor','horse','hour','house','human',
  'hunt',
  // I
  'idea','image','important','include','increase','indeed','inside','instead',
  'into','island',
  // J
  'job','join','just',
  // K
  'keep','kill','kind','king','know',
  // L
  'land','large','last','late','lead','learn','leave','level','life','light',
  'line','list','little','live','long','look','lord','lose','love','low',
  // M
  'made','make','man','many','mark','master','matter','mean','meet','men',
  'might','mind','moon','more','most','move','much','must',
  // N
  'name','nature','need','never','next','night','north','nothing','number',
  // O
  'ocean','often','once','only','open','order','other','our','out','over',
  'own',
  // P
  'part','pass','past','path','peace','people','place','plan','plant','point',
  'power','present','press','prove','pull','push',
  // Q
  'queen','question','quick','quite',
  // R
  'race','rain','reach','read','ready','real','reason','remain','return','right',
  'rise','river','road','rock','role','room','round','rule','run',
  // S
  'safe','same','scene','search','season','seem','send','sense','serve','set',
  'ship','short','should','show','side','sign','since','site','size','skill',
  'small','snow','some','song','soon','south','space','speak','speed','spend',
  'spirit','spread','spring','stand','star','start','stay','step','still',
  'stone','stop','store','storm','story','street','strong','study','such',
  'sure','system',
  // T
  'take','talk','tell','than','then','there','they','think','three','through',
  'time','together','too','took','toward','town','trade','train','tree','true',
  'trust','turn','type',
  // U
  'under','until','upon','use',
  // V
  'very','view','voice',
  // W
  'walk','want','war','water','west','what','when','where','while','white',
  'wide','will','wind','word','work','world','write',
  // Y
  'year','young','your',
  // Common 2-letter words
  'an','as','at','be','by','do','go','he','if','in','is','it','me','my',
  'no','of','on','or','so','to','up','us','we',
  // More common words
  'above','accept','account','agree','ahead','aim','area','argue','arrive',
  'author',
  'baby','basic','beach','beat','begin','below','beyond','birth','bite',
  'blind','block','blood','blow','blue','bold','bond','born','bound',
  'brain','brand','brave','bread','breed','brief','bring','broke','bunch',
  'burst','busy',
  'cage','calm','camp','card','cast','cave','central','chain','chair',
  'chance','chart','chase','chest','chief','choice','claim','clean','clear',
  'climb','clock','clone','cloth','cloud','code','colony','color','column',
  'combat','comfort','command','commit','compare','complex','concern',
  'confirm','contain','content','context','contract','contrast','cool',
  'copy','core','corner','council','crash','cream','crew','crime','crown',
  'cruel','crush','curve',
  'daily','dance','danger','daughter','deal','death','debate','decide',
  'declare','defend','define','delay','deliver','depend','depth','describe',
  'detail','detect','direct','display','doubt','drama','drink','drive',
  'drug','drum',
  'earn','east','easy','edge','eight','elect','email','emerge','empty',
  'enable','enjoy','entire','expect','explore','extend','extra',
  'faith','false','fame','fancy','farm','fate','fear','feast','federal',
  'fence','fever','fewer','final','flame','flash','fleet','flesh','float',
  'flood','flush','focus','fond','force','forest','forge','formal','forth',
  'found','frame','frank','fraud','front','fuel','funny','future',
  'gains','giant','grace','grade','grain','grand','grant','grasp','grave',
  'gray','grip','gross','grow','grunt','guard',
  'habit','happy','harsh','hate','haven','heavy','hence','honor','hope',
  'hotel','huge','humor',
  'ideal','identify','ignore','image','impact','imply','impose','income',
  'index','inform','inner','input','invest','involve','iron','issue',
  'joint','judge','jump',
  'keen','kitchen','knee','knife','knock','known',
  'labor','layer','leader','lean','least','legal','length','lend','lesson',
  'limit','link','loan','local','logic','loose','lower','lucky',
  'major','manage','manner','manual','match','mayor','media','metal',
  'method','model','month','moral','mount','muscle','music',
  'nation','nerve','network','noble','north','novel','nurse',
  'object','offer','often','option','organ','other','outer','output',
  'owner',
  'paint','panel','paper','patient','pause','peak','perfect','permit',
  'phase','phone','photo','pick','piece','pilot','pitch','pixel','plain',
  'plane','plate','plaza','plot','plug','plus','point','police','policy',
  'pool','poor','popular','port','pose','post','pound','pour','praise',
  'pray','prince','print','prior','prize','probe','profit','proud','prove',
  'pure','pursue',
  'rapid','rather','react','rebel','refer','relax','relay','rely','repair',
  'reply','report','rescue','reset','resort','result','reveal','revolt',
  'reward','ridge','right','rigid','risk','rough','royal',
  'scale','scene','score','scout','seal','secret','sector','select','sense',
  'serve','shade','shaft','shake','shall','shape','share','shelf','shell',
  'shift','shock','shoot','shore','shout','sight','signal','silent','silver',
  'simple','single','sixth','sleep','slice','slide','slight','slope','slow',
  'small','smart','smile','smoke','solid','solve','source','south','spark',
  'speak','spine','spite','split','spray','squad','stage','stake','state',
  'steam','steel','steep','stem','stick','stock','strain','strike','strip',
  'strive','stuff','style','suite','super','surge','surround','survey',
  'suspend','swap','sweep','swift','sword','symbol',
  'table','teach','team','teeth','trend','trial','tribe','trick','tried',
  'trigger','trim','triumph','trouble','track','trace','truly',
  'uncle','union','unique','unit','unity','unlock','upper','upset','urban',
  'usual',
  'valid','value','vary','venture','vessel','victim','visit','vital','void',
  'voter',
  'waste','watch','wealth','weapon','weight','whole','whose','width','witch',
  'women','worry',
  'yield',
  'zero','zone',
  // Words with specific combos
  // TR combos
  'track','trade','train','trap','trash','travel','treat','tree','trick',
  'trip','truck','true','trust','try','trail','tribe','trim','trend',
  'trumpet','trouble','transfer','transform','transition','trigger',
  'traditional','strategy','straight','strange','stream','street','stretch',
  'strength','structure','strong','struggle','strip','stride','strike',
  'string','strict','stress','strain','strand','strap','straw','stream',
  // ST combos
  'staff','stage','stain','stair','stamp','stand','star','start','state',
  'station','stay','steel','steep','step','stick','still','stock','stone',
  'stop','store','storm','story','straight','stream','street','strength',
  'stress','strict','string','strip','stroke','strong','struggle','student',
  'study','stuff','style','system','fast','last','best','past','list',
  'first','most','rest','test','west','dust','just','must','rust','trust',
  'blast','chest','coast','feast','forest','ghost','guest','honest','host',
  'least','mast','nest','post','roast','toast','twist','waste','yeast',
  // OU combos
  'about','around','bound','cloud','count','doubt','found','ground','group',
  'hour','house','loud','mount','mouth','our','out','proud','round','shout',
  'sound','south','throughout','touch','tough','tour','young','your',
  'account','amount','cloud','couch','county','fountain','journal','mountain',
  'noun','ounce','outline','output','outer','outrage','outside','outset',
  'pound','pour','scout','shoulder','shout','sound','soup','sour','south',
  'youth',
  // IN combos
  'again','begin','brain','cabin','chain','contain','explain','fin','find',
  'fine','finger','finish','fire','first','fish','five','given','grain',
  'king','kind','line','lion','main','mind','mine','minister','nation',
  'night','nine','obtain','ocean','opinion','origin','outline','pain','plain',
  'point','prince','print','rain','remain','ruin','saint','sign','since',
  'skin','spring','thin','think','train','twin','under','until','vine','within',
  // RE combos
  'area','create','dream','free','green','three','tree','agree','career',
  'center','change','describe','free','here','increase','interest','more',
  'order','over','prepare','present','receive','refer','release','require',
  'resolve','result','return','reveal','reveal','screen','secret','service',
  'shore','store','there','were','where','write','wrote',
  // ER combos
  'better','center','cover','danger','dealer','differ','dinner','driver',
  'enter','error','ever','father','fever','finger','flower','gather',
  'gender','however','hunter','inner','letter','master','matter','member',
  'number','offer','order','other','outer','owner','paper','player','power',
  'reader','refer','render','river','rubber','ruler','silver','sister',
  'super','teacher','tiger','timber','tower','under','upper','user','water',
  'weather','winner','wonder','worker','writer',
  // CH combos
  'attach','branch','catch','change','charge','chat','cheap','check','chest',
  'cheer','child','chip','choose','chose','church','coach','touch','teach',
  'beach','reach','bench','bunch','chain','chance','chant','chart','chase',
  'chest','chief','chin','choice','chunk','match','patch','reach','search',
  'watch','which',
  // SH combos
  'cash','crash','dash','dish','fish','flash','fresh','marsh','rush','splash',
  'slash','sheep','shell','shift','shine','shirt','shock','shoe','shoot',
  'shore','short','shot','shout','show','shut','shadow','shallow','shame',
  'shape','share','sharp','sheep','shelf','shield','shift','shine','ship',
  'shop','shoulder','shout','shower',
  // TH combos
  'faith','health','month','mouth','north','south','teeth','truth','width',
  'breath','cloth','death','growth','length','math','path','strength',
  'that','than','thank','them','then','there','these','they','thick',
  'thin','think','third','those','though','thought','thousand','three',
  'throw','thumb','thunder',
  // NG combos
  'among','bang','being','bring','during','evening','feeling','finding',
  'flying','going','hang','having','king','living','long','making','morning',
  'nothing','opening','ring','running','seeing','singing','something',
  'spring','sting','strong','swing','thing','thinking','young',
  // Additional common words to improve coverage
  'abandon','ability','absence','absolute','abstract','achieve','acquire',
  'address','advance','advice','affect','afford','afterward','agent',
  'ahead','alarm','album','alien','align','alive','alliance','allocate',
  'alter','amber','analysis','angle','announce','appeal','apply','appoint',
  'approach','approve','archive','attach','attend','attract','audit',
  'average','avoid',
  'banner','barely','barely','barrel','barrier','battle','benefit',
  'biology','bitter','blanket','border','bother','bottle','bounce',
  'brace','branch','breach','briefly','brighten','broken','budget',
  'bundle','bypass',
  'canvas','capable','capital','captain','capture','carpet','carry',
  'cattle','ceiling','center','channel','chapter','charge','chemical',
  'chicken','circle','circuit','citizen','classic','clearly','client',
  'cluster','collect','combine','comply','concept','conduct','conflict',
  'congress','connect','consent','consist','constant','construct','contact',
  'continue','convert','correct','council','couple','credit','crisis',
  'critic','current','custom',
  'damage','decide','decline','degree','demand','demon','depend','deposit',
  'design','despite','detect','device','digital','direct','discuss',
  'dismiss','distant','divide','domain','dominant','double','dozen',
  'driver',
  'effect','effort','either','element','empire','enable','engage','engine',
  'enough','ensure','entire','equal','escape','essence','establish','event',
  'evidence','evolve','exact','except','exist','expand','expert','extreme',
  'factor','failure','fallen','famous','fantasy','feature','federal',
  'fellow','figure','filter','finger','flight','flying','forest','formal',
  'fortune','forward','foster','fragment','freedom','frozen','function',
  'garden','gather','gentle','global','golden','govern','growth',
  'handle','happen','harvest','height','helpful','hidden','hospital',
  'however','humble','hunter',
  'island','jungle','justice',
  'keyboard','kingdom','kitchen','knowledge',
  'ladder','landing','language','laptop','launch','leader','legacy',
  'legend','leisure','library','listen','litter','living','locate',
  'longer','lovely','lucid',
  'manage','manager','marble','margin','market','massive','matrix',
  'medium','mental','merger','message','middle','mirror','missing',
  'mission','moment','monster','mother','motion','motive',
  'narrow','nearby','neutral','normal','notice',
  'obtain','occupy','online','operate','outside','overcome',
  'package','paradise','parent','partner','pattern','perfect','perhaps',
  'permit','person','picture','planet','player','pocket','popular',
  'portal','portal','positive','possible','potential','produce','profile',
  'program','promise','provide','public','purpose',
  'quality','quantity','quarter','query',
  'random','reader','recent','refine','region','release','remote',
  'remove','render','repeat','replace','request','resolve','respond',
  'restore','review','rewind','rhythm','rocket','rotate',
  'sample','screen','sector','secure','select','sender','sensitive',
  'server','settle','signal','simple','singer','skill','slider','socket',
  'soldier','solution','someone','special','sphere','spirit','spread',
  'square','stable','statue','status','steady','stream','student',
  'submit','sudden','supply','support','surface','surplus','survive',
  'switch','symbol','system',
  'talent','target','tasty','textile','texture','theme','theory',
  'timber','toward','transfer','travel','treasure','trigger','trouble',
  'tunnel','typical','united','stated','trusted','tested','listed',
  'wasted','posted','lasted','nested','tilted','gifted','gifted',
  'sorted','voted','noted','dated','rated','fated','mated',
  'unique','update','urban',
  'vector','version','village','volume',
  'warning','website','winter','wisdom','without','wonder',
  'yellow',
    ]);
  }
}

const WORD_SET = _loadWordSet();

function pickCombo() {
  const pool = Math.random() < 0.7 ? COMBOS_2 : COMBOS_3;
  return pool[Math.floor(Math.random() * pool.length)];
}

function isValidWord(word, combo, usedWords) {
  const w = word.toLowerCase().trim();
  if (w.length < 2) return { ok: false, reason: 'Too short' };
  if (!w.includes(combo.toLowerCase())) return { ok: false, reason: `Must contain "${combo}"` };
  if (usedWords.has(w)) return { ok: false, reason: 'Already used!' };
  if (!WORD_SET.has(w)) return { ok: false, reason: 'Not a valid word' };
  return { ok: true };
}

module.exports = { pickCombo, isValidWord, WORD_SET };

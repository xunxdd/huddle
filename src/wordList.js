const CATEGORIES = {
  'Animals': [
    'cat', 'dog', 'elephant', 'giraffe', 'penguin', 'butterfly', 'eagle', 'owl',
    'frog', 'turtle', 'rabbit', 'hamster', 'parrot', 'crocodile', 'kangaroo',
    'panda', 'lion', 'tiger', 'bear', 'wolf', 'fox', 'zebra', 'hippo', 'rhino',
    'gorilla', 'cheetah', 'flamingo', 'peacock', 'caterpillar', 'dragonfly',
    'deer', 'moose', 'otter', 'seal', 'koala',
  ],

  'Food & Drinks': [
    'pizza', 'burger', 'sushi', 'taco', 'sandwich', 'hotdog', 'donut', 'cupcake',
    'banana', 'watermelon', 'strawberry', 'pineapple', 'broccoli', 'carrot',
    'ice cream', 'chocolate', 'cookie', 'cake', 'popcorn', 'pretzel', 'waffle',
    'spaghetti', 'noodles', 'soup', 'salad', 'toast', 'bagel', 'muffin', 'pancake',
    'avocado', 'lemon', 'grapes', 'cherry', 'corn', 'potato', 'mushroom',
    'milkshake', 'burrito',
  ],

  'Objects & Tools': [
    'umbrella', 'telephone', 'television', 'clock', 'camera', 'guitar', 'piano',
    'drum', 'book', 'pencil', 'scissors', 'hammer', 'key', 'lamp', 'chair',
    'table', 'bed', 'ladder', 'shovel', 'bucket', 'mirror', 'brush', 'balloon',
    'trophy', 'crown', 'compass', 'magnet', 'candle', 'lantern', 'hourglass',
    'dice', 'backpack', 'glasses', 'helmet', 'magnifying glass', 'syringe',
    'thermometer', 'kite', 'parachute',
  ],

  'Nature & Weather': [
    'mountain', 'volcano', 'island', 'rainbow', 'tornado', 'lightning', 'snowflake',
    'cloud', 'wave', 'river', 'waterfall', 'forest', 'desert', 'beach', 'cave',
    'flower', 'tree', 'cactus', 'leaf', 'coral', 'glacier', 'swamp', 'sunset',
    'aurora', 'earthquake', 'hurricane', 'avalanche', 'meadow', 'canyon', 'geyser',
  ],

  'Activities & Sports': [
    'swimming', 'dancing', 'cooking', 'painting', 'fishing', 'skiing', 'surfing',
    'hiking', 'reading', 'sleeping', 'running', 'jumping', 'climbing', 'singing',
    'juggling', 'skateboarding', 'gardening', 'boxing', 'archery', 'diving',
    'cycling', 'yoga', 'wrestling', 'bowling', 'golfing',
  ],

  'Places & Buildings': [
    'castle', 'lighthouse', 'bridge', 'hospital', 'school', 'library', 'museum',
    'stadium', 'airport', 'pyramid', 'igloo', 'windmill', 'factory', 'farm',
    'temple', 'skyscraper', 'treehouse', 'market', 'church', 'mansion',
    'tower', 'barn', 'cabin', 'palace', 'dungeon',
  ],

  'People & Jobs': [
    'doctor', 'teacher', 'chef', 'clown', 'superhero', 'ninja', 'cowboy',
    'princess', 'king', 'detective', 'firefighter', 'scientist', 'pilot',
    'baker', 'engineer', 'architect', 'nurse', 'sailor', 'astronaut',
    'artist', 'musician', 'judge', 'athlete', 'farmer', 'librarian',
  ],

  'Vehicles & Transport': [
    'train', 'helicopter', 'motorcycle', 'truck', 'ambulance', 'taxi',
    'hot air balloon', 'sailboat', 'tractor', 'forklift', 'bulldozer', 'scooter',
    'airplane', 'boat', 'rocket', 'bicycle', 'submarine', 'cable car',
    'ferry', 'spaceship', 'jeep',
  ],

  'Fantasy & Myths': [
    'dragon', 'unicorn', 'wizard', 'mermaid', 'fairy', 'phoenix', 'goblin',
    'troll', 'elf', 'centaur', 'sphinx', 'pegasus', 'yeti', 'cyclops',
    'griffin', 'vampire', 'witch', 'ghost', 'pirate', 'knight',
  ],

  'Ocean & Sea Life': [
    'dolphin', 'shark', 'octopus', 'jellyfish', 'starfish', 'crab', 'lobster',
    'whale', 'seahorse', 'stingray', 'clownfish', 'squid', 'seal', 'walrus',
    'seagull', 'anchor', 'coral', 'snail', 'eel', 'manta ray',
  ],

  'Space & Science': [
    'rocket', 'telescope', 'microscope', 'comet', 'moon', 'planet', 'star',
    'eclipse', 'astronaut', 'alien', 'satellite', 'meteor', 'nebula',
    'black hole', 'orbit', 'laser', 'robot', 'magnet', 'crystal', 'volcano',
  ],

  'Halloween': [
    'jack-o-lantern', 'ghost', 'vampire', 'zombie', 'witch', 'skeleton', 'bat',
    'spider', 'cauldron', 'scarecrow', 'pumpkin', 'mummy', 'tombstone', 'candy',
    'haunted house', 'werewolf', 'black cat', 'potion', 'cobweb', 'coffin',
  ],
};

// Keep defaultWords as flat list for backward compat / Mixed mode
const defaultWords = Object.values(CATEGORIES).flat();

/**
 * Returns n category names: always includes 'Mixed', rest random
 */
function pickCategoryOptions(n = 6) {
  const names = Object.keys(CATEGORIES);
  // Shuffle
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  // Take (n-1) random categories, then add Mixed
  const picks = names.slice(0, n - 1);
  picks.push('Mixed');
  return picks;
}

/**
 * Pick n random words from the pool
 * @param {number} n
 * @param {string[]} customWords
 * @param {boolean} customOnly
 * @param {string|null} category - category name or null/'Mixed' for all
 */
function pickWords(n, customWords = [], customOnly = false, category = null) {
  let pool;
  if (customOnly && customWords.length >= n) {
    pool = [...customWords];
  } else if (category && category !== 'Mixed' && CATEGORIES[category]) {
    pool = [...CATEGORIES[category], ...customWords];
  } else {
    pool = [...defaultWords, ...customWords];
  }
  // Fisher-Yates shuffle then slice
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/**
 * Returns a display string with revealed letters and _ for unrevealed.
 * Each character position separated by a space.
 * e.g. "apple" with revealedIndices=[4] -> "_ _ _ _ e"
 * e.g. "ice cream" -> "_ _ _   _ _ _ _ _" (space preserved)
 */
function getHintMask(word, revealedIndices) {
  return word
    .split('')
    .map((char, i) => {
      if (char === ' ') return ' ';
      if (revealedIndices.includes(i)) return char;
      return '_';
    })
    .join(' ');
}

/**
 * Returns all indices of non-space characters in the word
 */
function getRevealableIndices(word) {
  return word.split('').reduce((acc, char, i) => {
    if (char !== ' ') acc.push(i);
    return acc;
  }, []);
}

module.exports = { defaultWords, CATEGORIES, pickWords, pickCategoryOptions, getHintMask, getRevealableIndices };

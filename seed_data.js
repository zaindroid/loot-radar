/* Demo dataset shared by seed.js (CLI) and server.js (first-boot autoseed).
   looter, hall, stand, company, item, rarity, dx, dy (dx/dy in map fraction) */
'use strict';
const DEMO_LOOTERS = ['zain', 'mira', 'kai', 'nova'];
const DEMO_LOOT = [
  ['zain', '8', 'B45', 'Bandai Namco', 'Signed Jujutsu Kaisen figure', 5, 0.0, -0.006],
  ['zain', '8', 'B12', 'Capcom', 'Limited RE4 art print', 4, 0.05, 0.02],
  ['zain', '11', 'E08', 'Konami', 'PEAK x gamescom exclusive tee', 4, 0.0, 0.0],
  ['zain', '6', 'A22', 'Razer', 'Free Viper V3 + mousepad', 3, 0.0, 0.0],
  ['zain', '5', 'C31', 'Steam', 'Free 10% key + wallet', 2, -0.045, 0.0],
  ['mira', '9', 'D15', 'Nintendo', 'Metroid themed snapback cap', 3, 0.0, 0.0],
  ['mira', '9', 'D04', 'Nintendo', 'Signed Switch 2 dev unit', 5, 0.05, -0.03],
  ['mira', '4.1', 'F20', 'Epic Games', 'Unreal 6 dev license', 4, 0.0, 0.0],
  ['mira', '2.1', 'G11', 'Paradox', 'Handmade Europa Universalis poster', 2, 0.0, 0.03],
  ['kai', '6', 'A05', 'HyperX', 'Alone in the Dark plush', 3, -0.04, 0.03],
  ['kai', '5', 'C44', 'Xbox', 'Free Xbox Game Pass code', 3, 0.05, 0.04],
  ['kai', '1', 'H02', 'Ubisoft', 'Prince of Persia signed copy', 4, 0.0, -0.04],
  ['kai', '10.1', 'J18', 'Bethesda', 'Doom x gamescom steelbook', 5, 0.0, 0.04],
  ['kai', '10.2', 'J09', 'Indie Arena', 'Dev copy + Indie swag bag', 4, 0.0, -0.03],
  ['nova', '3.1', 'K09', 'Riot Games', 'Valorant exclusive sticker pack', 2, 0.0, 0.0],
  ['nova', '4.1', 'L03', 'Valve', 'Free Steam wallet $50', 1, -0.04, 0.02],
  ['nova', '7', 'M27', 'Warner Bros', 'Suicide Squad: Kill City demo disc', 1, 0.0, 0.0],
  ['zain', '5.1', 'N01', 'PlayStation', 'PS5 era limited art card', 3, 0.0, 0.0],
];
const DEMO_COMMENTS = [
  [0, 'zain', 'signed + boxed, go fast - north entrance side'],
  [1, 'mira', 'they were handing these out till like 2pm'],
  [6, 'kai', 'dev unit is INSANE, only a few left'],
  [12, 'nova', 'steelbook at 10.1, they are restocking every hour'],
  [2, 'zain', 'limited run, 500 pieces total worldwide'],
];
// HALL center coordinates (fraction of the 1600px L1 map)
const HALL_XY = {
  '8': [0.451, 0.097], '7': [0.427, 0.210], '6': [0.451, 0.314], '5': [0.542, 0.251],
  '5.1': [0.499, 0.480], '4.1': [0.486, 0.584], '4.2': [0.479, 0.596],
  '1': [0.354, 0.466], '2.1': [0.428, 0.773], '3.1': [0.484, 0.773], '3.2': [0.477, 0.784],
  '11': [0.387, 0.502], '11.1': [0.602, 0.780], '9': [0.703, 0.401],
  '10.1': [0.667, 0.500], '10.2': [0.658, 0.528],
};
module.exports = { DEMO_LOOTERS, DEMO_LOOT, DEMO_COMMENTS, HALL_XY };

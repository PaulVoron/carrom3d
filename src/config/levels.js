export const CHALLENGE_LEVELS = [
  {
    id: 1,
    starThresholds: [1, 2, 3], // 1 удар = 3 звезды, 2 удара = 2 звезды, 3 удара = 1 звезда
    allowedPockets: [1, 2],
    coins: [
      { color: 'white', x: 0.125, z: 0.125 },
    ],
  },
  {
    id: 2,
    starThresholds: [2, 3, 4],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.15, z: 0.15 },
      { color: 'white', x: -0.15, z: -0.15 },
    ],
  },
  {
    id: 3,
    starThresholds: [2, 3, 4],
    allowedPockets: [0, 2, 3], // Верхняя левая и нижняя правая
    coins: [
      { color: 'white', x: 0.25, z: 0.0 }, // Фишка у борта (cut shot)
      { color: 'black', x: -0.25, z: 0.0 }, // Фишка у борта (cut shot)
    ],
  },
  {
    id: 4,
    starThresholds: [2, 3, 5],
    allowedPockets: [1, 2, 3],
    coins: [
      { color: 'white', x: 0.248, z: 0.17 },
      { color: 'black', x: 0.2, z: 0.2 },
      { color: 'white', x: 0.17, z: 0.248 },
    ],
  },
  {
    id: 5,
    starThresholds: [2, 3, 4],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0, z: -0.1 }, // Bank shot
      { color: 'black', x: 0, z: 0.1 }, // Препятствие
    ],
  },
  {
    id: 6,
    starThresholds: [3, 4, 6],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.1, z: 0.1 },
      { color: 'white', x: -0.1, z: 0.1 },
      { color: 'black', x: 0, z: -0.15 },
    ],
  },
  {
    id: 7,
    starThresholds: [3, 4, 5],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.1, z: -0.2 },
      { color: 'white', x: -0.1, z: -0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
  {
    id: 8,
    starThresholds: [4, 5, 6],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.2, z: 0 },
      { color: 'white', x: -0.2, z: 0 },
      { color: 'black', x: 0.1, z: 0.1 },
      { color: 'black', x: -0.1, z: -0.1 },
    ],
  },
  {
    id: 9,
    starThresholds: [4, 5, 7],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.15, z: 0.15 },
      { color: 'white', x: -0.15, z: 0.15 },
      { color: 'white', x: 0, z: -0.2 },
      { color: 'black', x: 0, z: -0.1 },
    ],
  },
  {
    id: 10,
    starThresholds: [5, 6, 8],
    allowedPockets: [0, 1],
    coins: [
      { color: 'white', x: 0.2, z: 0.2 },
      { color: 'white', x: -0.2, z: -0.2 },
      { color: 'white', x: 0.2, z: -0.2 },
      { color: 'white', x: -0.2, z: 0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
  {
    id: 11,
    starThresholds: [2, 3, 4],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: -0.125, z: 0.125 },
      { color: 'white', x: 0.125, z: 0.125 },
    ],
  },
  {
    id: 12,
    starThresholds: [2, 3, 4],
    allowedPockets: [2, 3],
    coins: [
      { color: 'black', x: 0.15, z: 0.15 },
      { color: 'black', x: -0.15, z: -0.15 },
    ],
  },
  {
    id: 13,
    starThresholds: [2, 3, 4],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: 0.25, z: 0.0 }, // Фишка у борта (cut shot)
      { color: 'black', x: -0.25, z: 0.0 }, // Фишка у борта (cut shot)
    ],
  },
  {
    id: 14,
    starThresholds: [2, 3, 5],
    allowedPockets: [0, 1, 3],
    coins: [
      { color: 'white', x: 0.248, z: 0.17 },
      { color: 'black', x: 0.2, z: 0.2 },
      { color: 'white', x: 0.17, z: 0.248 },
    ],
  },
  {
    id: 15,
    starThresholds: [2, 3, 4],
    allowedPockets: [2, 3],
    coins: [
      { color: 'black', x: 0, z: -0.1 }, // Bank shot
      { color: 'white', x: 0, z: 0.1 }, // Препятствие
    ],
  },
  {
    id: 16,
    starThresholds: [3, 4, 5],
    allowedPockets: [2, 3],
    coins: [
      { color: 'black', x: 0.1, z: 0.1 },
      { color: 'black', x: -0.1, z: 0.1 },
      { color: 'white', x: 0, z: -0.15 },
    ],
  },
  {
    id: 17,
    starThresholds: [3, 4, 5],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: 0.1, z: -0.2 },
      { color: 'white', x: -0.1, z: -0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
  {
    id: 18,
    starThresholds: [4, 5, 7],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: 0.2, z: 0 },
      { color: 'white', x: -0.2, z: 0 },
      { color: 'black', x: 0.1, z: 0.1 },
      { color: 'black', x: -0.1, z: -0.1 },
    ],
  },
  {
    id: 19,
    starThresholds: [4, 5, 7],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: 0.15, z: 0.15 },
      { color: 'white', x: -0.15, z: 0.15 },
      { color: 'white', x: 0, z: -0.2 },
      { color: 'black', x: 0, z: -0.1 },
    ],
  },
  {
    id: 20,
    starThresholds: [6, 7, 8],
    allowedPockets: [2, 3],
    coins: [
      { color: 'white', x: 0.2, z: 0.2 },
      { color: 'white', x: -0.2, z: -0.2 },
      { color: 'white', x: 0.2, z: -0.2 },
      { color: 'white', x: -0.2, z: 0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
];

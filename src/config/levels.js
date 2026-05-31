export const CHALLENGE_LEVELS = [
  {
    id: 1,
    starThresholds: [1, 2, 3], // 1 удар = 3 звезды, 2 удара = 2 звезды, 3 удара = 1 звезда
    allowedPockets: [0, 1], // Верхние лузы
    coins: [
      { color: 'white', x: 0.2, z: 0.2 },
    ],
  },
  {
    id: 2,
    starThresholds: [2, 3, 4],
    allowedPockets: [2], // Нижняя правая луза
    coins: [
      { color: 'white', x: 0.15, z: 0.15 },
      { color: 'white', x: -0.15, z: -0.15 },
    ],
  },
  {
    id: 3,
    starThresholds: [1, 2, 3],
    allowedPockets: [0, 2], // Верхняя левая и нижняя правая
    coins: [
      { color: 'white', x: 0.25, z: 0.0 }, // Фишка у борта (cut shot)
    ],
  },
  {
    id: 4,
    starThresholds: [2, 3, 5],
    coins: [
      { color: 'white', x: 0.2, z: 0.2 },
      { color: 'white', x: 0.22, z: 0.18 },
      { color: 'white', x: 0.18, z: 0.22 },
    ],
  },
  {
    id: 5,
    starThresholds: [1, 2, 4],
    coins: [
      { color: 'white', x: 0, z: -0.1 }, // Bank shot
      { color: 'black', x: 0, z: 0.1 }, // Препятствие
    ],
  },
  {
    id: 6,
    starThresholds: [3, 4, 6],
    coins: [
      { color: 'white', x: 0.1, z: 0.1 },
      { color: 'white', x: -0.1, z: 0.1 },
      { color: 'white', x: 0, z: -0.15 },
    ],
  },
  {
    id: 7,
    starThresholds: [2, 3, 5],
    coins: [
      { color: 'white', x: 0.1, z: -0.2 },
      { color: 'white', x: -0.1, z: -0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
  {
    id: 8,
    starThresholds: [2, 4, 6],
    coins: [
      { color: 'white', x: 0.2, z: 0 },
      { color: 'white', x: -0.2, z: 0 },
      { color: 'black', x: 0.1, z: 0.1 },
      { color: 'black', x: -0.1, z: -0.1 },
    ],
  },
  {
    id: 9,
    starThresholds: [3, 5, 7],
    coins: [
      { color: 'white', x: 0.15, z: 0.15 },
      { color: 'white', x: -0.15, z: 0.15 },
      { color: 'white', x: 0, z: -0.2 },
      { color: 'black', x: 0, z: -0.1 },
    ],
  },
  {
    id: 10,
    starThresholds: [4, 6, 8],
    coins: [
      { color: 'white', x: 0.2, z: 0.2 },
      { color: 'white', x: -0.2, z: -0.2 },
      { color: 'white', x: 0.2, z: -0.2 },
      { color: 'white', x: -0.2, z: 0.2 },
      { color: 'black', x: 0, z: 0 },
    ],
  },
];

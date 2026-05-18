import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import gsap from 'gsap';
import { create3DScene, loadModel, scene, camera, renderer, controls } from './3d-scene.js';
import { START_CAMERA_POSITION } from './settings.js';

const DEBUG_MODE = false;

let world;
let physicsBodies = []; // Массив объектов: { mesh, body }

// === STATE MACHINE ===
let gameState = 'PLACEMENT'; // Состояния: PLACEMENT, AIMING, MOVING

// === RULES ENGINE STATE ===
let currentPlayer = 1;
let scores = { player1: 0, player2: 0 };
let queenState = 'on_board'; // 'on_board' | 'pocketed_uncovered' | 'covered'
let turnEvents = { pocketedOwn: 0, pocketedOpponent: 0, pocketedQueen: false, isFoul: false };


// === НАСТРОЙКИ ФИЗИКИ (Единый пульт управления) ===
const PHYSICS = {
  damping: 0.3,           // Скольжение (меньше = дольше катятся)
  friction: 0.03,          // Трение доски (пудра)
  restitution: 0.7,       // Упругость фишек (отскок друг от друга)
  boardRestitution: 0.6,  // Упругость бортов стола

  // Массы в килограммах (СИ)
  massStriker: 0.015,     // 15 грамм
  massCoin: 0.0055,       // 5.5 грамм

  // Настройки Рогатки
  maxPullDistance: 0.2,  // Максимальная длина оттяжки (15 см)
  strikerForce: 0.5,      // Множитель силы импульса
  solverIterations: 15,   // Точность физики (спасает от проваливаний сквозь текстуры)

  // === ФИКСИРОВАННЫЙ TIMESTEP ===
  // При 240Hz каждый шаг = 4.16ms. Биток на макс скорости (~5 м/с) пролетает
  // всего ~2 см за шаг — это МЕНЬШЕ радиуса фишки (1.59 см), что гарантирует коллизию.
  fixedTimeStep: 1 / 240, // 240 Hz физика
  maxSubSteps: 8,         // Макс шагов за кадр (защита от spiral of death)
  maxCcdSubsteps: 4,      // CCD подшаги внутри каждого fixedStep (подстраховка)

  // Ограничитель скорости (предотвращает туннелирование при экстремальных импульсах)
  // Фишка диаметром 3.18 см: maxSpeed = 0.0159 / fixedTimeStep * 0.8 ≈ 3 м/с
  maxLinearSpeed: 3.0,    // м/с — абсолютный потолок скорости любого тела

  // Настройки Луз
  pocketRadius: 0.02275,  // Радиус лузы (44.5 мм / 2)
  pocketFallDepth: -0.1,  // На какой глубине удалять фишку со сцены

  // === POCKET DRAG (Эффект "засасывания" в лузу) ===
  // Когда фишка пролетает над лузой, замедляем горизонтальную скорость
  // и притягиваем к центру лузы — имитируя проваливание в отверстие.
  pocketDragFactor: 0.85,   // Множитель горизонтальной скорости за шаг (0.85 = 15% потери за шаг при 240Hz)
  pocketPullForce: 0.3,     // Сила притяжения к центру лузы (Н). Больше = агрессивнее затягивает
};

// === МАСКИ СТОЛКНОВЕНИЙ ===
const COL_GROUP_COIN = 0x0001;
const COL_GROUP_FLOOR = 0x0002;
const COL_GROUP_WALLS = 0x0004;

// Нормальное состояние: фишка сталкивается с другими фишками, полом и стенами
const MASK_COIN_NORMAL = (COL_GROUP_COIN << 16) | (COL_GROUP_COIN | COL_GROUP_FLOOR | COL_GROUP_WALLS);

// Состояние падения: фишка сталкивается с фишками и стенами, но НЕ С ПОЛОМ
const MASK_COIN_FALLING = (COL_GROUP_COIN << 16) | (COL_GROUP_COIN | COL_GROUP_WALLS);

const MASK_FLOOR = (COL_GROUP_FLOOR << 16) | COL_GROUP_COIN;
const MASK_WALLS = (COL_GROUP_WALLS << 16) | COL_GROUP_COIN;

let pocketCenters = []; // Сюда запишем центры луз

// === STRIKER PLACEMENT CONSTANTS ===
const PLAYER_1_LINE_Z = 0.25;   // Фиксированная Z-координата базовой линии Игрока 1 (ближняя к камере, Z+)
const PLAYER_2_LINE_Z = -0.25;  // Фиксированная Z-координата базовой линии Игрока 2 (дальняя от камеры, Z-)
const PLAYER_1_MIN_X = -0.20;   // Левая граница перемещения битка
const PLAYER_1_MAX_X = 0.20;    // Правая граница перемещения битка

function getCurrentLineZ() {
  return currentPlayer === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z;
}

// === STRIKER REFERENCES (заполняются при спавне) ===
let strikerEntry = null;        // { mesh, body } — ссылка на биток в physicsBodies
let strikerPhysRadius = 0;      // Физический радиус битка
let coinPhysRadius = 0;         // Физический радиус фишки
let strikerSpawnY = 0;          // Y-координата спавна битка

// === DRAG STATE ===
let isDragging = false;
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Горизонтальная плоскость Y

// === AIMING STATE ===
let isAiming = false;
let aimLine = null;
let aimStartPoint = new THREE.Vector3(); // Точка клика
let currentImpulse = new THREE.Vector3(); // Вектор удара

// === MOVING LOGIC ===
let checkSleepFrameCount = 0;

// === FIXED TIMESTEP ACCUMULATOR ===
let physicsAccumulator = 0;
let lastPhysicsTime = 0;

// === UI BUTTON ===
let confirmButton = null;

// --- UI ---
function createUI() {
  confirmButton = document.createElement('button');
  confirmButton.id = 'btn-confirm-placement';
  confirmButton.textContent = 'Готов к удару';

  Object.assign(confirmButton.style, {
    position: 'fixed',
    bottom: '32px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '14px 36px',
    fontSize: '16px',
    fontWeight: '600',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    color: '#ffffff',
    background: 'linear-gradient(135deg, #4f8cff 0%, #3366cc 100%)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(79, 140, 255, 0.4)',
    transition: 'all 0.25s ease',
    zIndex: '1000',
    letterSpacing: '0.5px',
    userSelect: 'none',
  });

  // Hover эффект
  confirmButton.addEventListener('mouseenter', () => {
    if (!confirmButton.disabled) {
      confirmButton.style.boxShadow = '0 6px 28px rgba(79, 140, 255, 0.6)';
      confirmButton.style.transform = 'translateX(-50%) translateY(-2px)';
    }
  });
  confirmButton.addEventListener('mouseleave', () => {
    confirmButton.style.boxShadow = confirmButton.disabled
      ? '0 2px 8px rgba(0,0,0,0.15)'
      : '0 4px 20px rgba(79, 140, 255, 0.4)';
    confirmButton.style.transform = 'translateX(-50%)';
  });

  confirmButton.addEventListener('click', onConfirmPlacement);

  document.body.appendChild(confirmButton);
  updateButtonVisibility();
}

function onConfirmPlacement() {
  if (gameState !== 'PLACEMENT' || !strikerEntry) return;
  if (confirmButton.disabled) return;

  // Запоминаем текущую позицию битка ДО смены типа тела
  const currentPos = strikerEntry.mesh.position.clone();

  gameState = 'AIMING';
  updateButtonVisibility();

  // Сбрасываем аккумулятор, чтобы первый кадр после паузы не получил огромный delta
  lastPhysicsTime = 0;
  physicsAccumulator = 0;

  // Переводим биток из kinematic в dynamic для физического взаимодействия
  const body = strikerEntry.body;
  body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  // Восстанавливаем позицию (setBodyType может сбросить её)
  body.setTranslation({ x: currentPos.x, y: currentPos.y, z: currentPos.z }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.wakeUp();

  console.log(`🎱 State → AIMING: Биток зафиксирован на X=${currentPos.x.toFixed(3)}, готов к удару!`);
}

function updateButtonVisibility() {
  if (!confirmButton) return;
  confirmButton.style.display = (gameState === 'PLACEMENT') ? 'block' : 'none';
}

function setButtonDisabled(disabled) {
  if (!confirmButton) return;
  confirmButton.disabled = disabled;
  if (disabled) {
    confirmButton.style.background = 'linear-gradient(135deg, #888 0%, #666 100%)';
    confirmButton.style.cursor = 'not-allowed';
    confirmButton.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    confirmButton.style.opacity = '0.6';
  } else {
    confirmButton.style.background = 'linear-gradient(135deg, #4f8cff 0%, #3366cc 100%)';
    confirmButton.style.cursor = 'pointer';
    confirmButton.style.boxShadow = '0 4px 20px rgba(79, 140, 255, 0.4)';
    confirmButton.style.opacity = '1';
  }
}

// === RULES ENGINE UI & LOGIC ===
function createScoreUI() {
  const style = document.createElement('style');
  style.textContent = `
    #carrom-score-ui {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 12px 24px;
      background: rgba(20, 20, 25, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #fff;
      z-index: 1000;
      pointer-events: none;
      user-select: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .player-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 16px;
      border-radius: 12px;
      min-width: 100px;
      transition: all 0.3s ease;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .player-panel.player-1.active {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.6);
      box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
    }
    .player-panel.player-2.active {
      background: rgba(0, 0, 0, 0.4);
      border-color: rgba(79, 140, 255, 0.5);
      box-shadow: 0 0 15px rgba(79, 140, 255, 0.25);
    }
    .player-name {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .player-1 .player-name {
      color: #ffffff;
      text-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
    }
    .player-2 .player-name {
      color: #88888c;
    }
    .player-score {
      font-size: 28px;
      font-weight: 800;
      line-height: 1;
      font-feature-settings: "tnum";
    }
    .center-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
    }
    #turn-indicator {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 6px 14px;
      border-radius: 30px;
      transition: all 0.3s ease;
      animation: pulse-glow 2s infinite ease-in-out;
    }
    #turn-indicator.turn-p1 {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.3);
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
    }
    #turn-indicator.turn-p2 {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.35);
      text-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
    }
    .queen-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 16px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      min-width: 90px;
    }
    .queen-label {
      font-size: 10px;
      font-weight: 600;
      color: #ff4f4f;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .queen-badge {
      font-size: 13px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      transition: all 0.3s ease;
    }
    .queen-on-board {
      color: #ff4f4f;
      background: rgba(255, 79, 79, 0.1);
      border: 1px solid rgba(255, 79, 79, 0.25);
    }
    .queen-pocketed-uncovered {
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.15);
      border: 1px solid rgba(251, 191, 36, 0.3);
      animation: flash-warning 1s infinite alternate;
    }
    .queen-covered {
      color: #10b981;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    @keyframes pulse-glow {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }
    @keyframes flash-warning {
      0% { opacity: 0.6; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'carrom-score-ui';
  container.innerHTML = `
    <div class="player-panel player-1 active" id="panel-p1">
      <div class="player-name">Игрок 1 (Белые)</div>
      <div class="player-score" id="score-p1">0</div>
    </div>
    
    <div class="center-panel">
      <div id="turn-indicator" class="turn-p1">ХОД: ИГРОК 1</div>
    </div>
    
    <div class="player-panel player-2" id="panel-p2">
      <div class="player-name">Игрок 2 (Черные)</div>
      <div class="player-score" id="score-p2">0</div>
    </div>
    
    <div class="queen-panel">
      <div class="queen-label">Королева</div>
      <div class="queen-badge queen-on-board" id="queen-status">На столе</div>
    </div>
  `;
  document.body.appendChild(container);
  
  updateScoreUI();
}

function updateScoreUI() {
  const scoreP1El = document.getElementById('score-p1');
  const scoreP2El = document.getElementById('score-p2');
  const turnIndEl = document.getElementById('turn-indicator');
  const queenStatEl = document.getElementById('queen-status');
  const panelP1 = document.getElementById('panel-p1');
  const panelP2 = document.getElementById('panel-p2');

  if (!scoreP1El || !scoreP2El || !turnIndEl || !queenStatEl || !panelP1 || !panelP2) return;

  scoreP1El.textContent = scores.player1;
  scoreP2El.textContent = scores.player2;

  if (currentPlayer === 1) {
    turnIndEl.textContent = 'ХОД: ИГРОК 1';
    turnIndEl.className = 'turn-p1';
    panelP1.classList.add('active');
    panelP2.classList.remove('active');
  } else {
    turnIndEl.textContent = 'ХОД: ИГРОК 2';
    turnIndEl.className = 'turn-p2';
    panelP1.classList.remove('active');
    panelP2.classList.add('active');
  }

  if (queenState === 'on_board') {
    queenStatEl.textContent = 'На столе';
    queenStatEl.className = 'queen-badge queen-on-board';
  } else if (queenState === 'pocketed_uncovered') {
    queenStatEl.textContent = 'Забита';
    queenStatEl.className = 'queen-badge queen-pocketed-uncovered';
  } else if (queenState === 'covered') {
    queenStatEl.textContent = 'Закрыта';
    queenStatEl.className = 'queen-badge queen-covered';
  }
}

function evaluateTurn() {
  console.log(`📊 Evaluating turn for Player ${currentPlayer}. Events:`, turnEvents);

  // Обновляем очки
  if (currentPlayer === 1) {
    scores.player1 += turnEvents.pocketedOwn;
    scores.player2 += turnEvents.pocketedOpponent;
  } else {
    scores.player2 += turnEvents.pocketedOwn;
    scores.player1 += turnEvents.pocketedOpponent;
  }

  // Фиксируем статус Королевы
  if (turnEvents.pocketedQueen) {
    if (turnEvents.pocketedOwn > 0 && !turnEvents.isFoul) {
      queenState = 'covered';
      console.log(`👑 Queen pocketed and COVERED on the same turn!`);
    } else {
      queenState = 'pocketed_uncovered';
      console.log(`👑 Queen pocketed but NOT covered yet.`);
    }
  } else if (queenState === 'pocketed_uncovered') {
    if (turnEvents.pocketedOwn > 0 && !turnEvents.isFoul) {
      queenState = 'covered';
      console.log(`👑 Queen is now COVERED!`);
    }
  }

  let nextPlayer = currentPlayer;

  if (turnEvents.isFoul) {
    console.log(`❌ Foul! Player ${currentPlayer} pocketed the striker.`);
    nextPlayer = (currentPlayer === 1) ? 2 : 1;
  } else if (turnEvents.pocketedOwn > 0) {
    console.log(`🎯 Player ${currentPlayer} pocketed their own coin! Extra turn.`);
    nextPlayer = currentPlayer;
  } else {
    // Либо забита только чужая фишка, либо ничего не забито
    nextPlayer = (currentPlayer === 1) ? 2 : 1;
    if (turnEvents.pocketedOpponent > 0) {
      console.log(`🔄 Player ${currentPlayer} pocketed only opponent's coin. Turn switches.`);
    } else {
      console.log(`💤 Player ${currentPlayer} didn't pocket anything. Turn switches.`);
    }
  }

  currentPlayer = nextPlayer;

  // Очищаем события для следующего хода
  turnEvents = {
    pocketedOwn: 0,
    pocketedOpponent: 0,
    pocketedQueen: false,
    isFoul: false
  };

  updateScoreUI();
}

function rotateCameraForPlayer(player) {
  if (!camera || !controls) return;
  
  controls.enabled = false;
  
  const targetX = player === 1 ? START_CAMERA_POSITION[0] : -START_CAMERA_POSITION[0];
  const targetY = START_CAMERA_POSITION[1];
  const targetZ = player === 1 ? START_CAMERA_POSITION[2] : -START_CAMERA_POSITION[2];
  
  if (gsap) {
    // Плавно сбрасываем target в (0,0,0)
    gsap.to(controls.target, {
      x: 0,
      y: 0,
      z: 0,
      duration: 1.5,
      ease: "power2.inOut",
      onUpdate: () => controls.update()
    });

    // Плавно вращаем камеру вокруг стола
    const startX = camera.position.x;
    const startZ = camera.position.z;
    const startY = camera.position.y;
    
    const startAngle = Math.atan2(startZ, startX);
    let endAngle = Math.atan2(targetZ, targetX);
    
    // Ищем кратчайший путь поворота
    let diff = endAngle - startAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    endAngle = startAngle + diff;

    const startRadius = Math.hypot(startX, startZ);
    const endRadius = Math.hypot(targetX, targetZ);

    const proxy = { angle: startAngle, radius: startRadius, y: startY };

    gsap.to(proxy, {
      angle: endAngle,
      radius: endRadius,
      y: targetY,
      duration: 1.5,
      ease: "power2.inOut",
      onUpdate: () => {
        camera.position.x = proxy.radius * Math.cos(proxy.angle);
        camera.position.z = proxy.radius * Math.sin(proxy.angle);
        camera.position.y = proxy.y;
        controls.update();
        if (window.requestRender) window.requestRender();
      },
      onComplete: () => {
        controls.enabled = true;
        controls.update();
        if (window.requestRender) window.requestRender();
      }
    });
  } else {
    controls.target.set(0, 0, 0);
    camera.position.set(targetX, targetY, targetZ);
    controls.update();
    controls.enabled = true;
  }
}


// --- DRAG & DROP (PLACEMENT MODE) ---

function setupPlacementControls() {
  const domElement = renderer.domElement;

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
}

function onPointerDown(event) {
  if (gameState === 'PLACEMENT' && strikerEntry) {
    updatePointerNDC(event);
    raycaster.setFromCamera(pointerNDC, camera);

    // Проверяем, попал ли клик на биток
    const intersects = raycaster.intersectObject(strikerEntry.mesh, true);
    if (intersects.length > 0) {
      isDragging = true;
      // Блокируем OrbitControls, чтобы камера не вращалась при перетаскивании
      if (controls) controls.enabled = false;
      // Обновляем плоскость перетаскивания на высоту битка
      dragPlane.set(new THREE.Vector3(0, 1, 0), -strikerSpawnY);
    }
  } else if (gameState === 'AIMING' && strikerEntry) {
    updatePointerNDC(event);
    raycaster.setFromCamera(pointerNDC, camera);

    const intersects = raycaster.intersectObject(strikerEntry.mesh, true);
    if (intersects.length > 0) {
      isAiming = true;
      if (controls) controls.enabled = false;
      dragPlane.set(new THREE.Vector3(0, 1, 0), -strikerSpawnY);

      // Запоминаем стартовую точку
      if (raycaster.ray.intersectPlane(dragPlane, aimStartPoint)) {
        // Успешно нашли точку на плоскости
      }
    }
  }
}

function onPointerMove(event) {
  if (gameState === 'PLACEMENT' && strikerEntry && isDragging) {
    updatePointerNDC(event);
    raycaster.setFromCamera(pointerNDC, camera);

    // Находим точку пересечения луча с горизонтальной плоскостью
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      // Ограничиваем X в пределах базовой линии
      const clampedX = THREE.MathUtils.clamp(intersection.x, PLAYER_1_MIN_X, PLAYER_1_MAX_X);

      // Перемещаем физическое тело (kinematic) — Y и Z заблокированы
      strikerEntry.body.setNextKinematicTranslation(
        { x: clampedX, y: strikerSpawnY, z: getCurrentLineZ() },
        true
      );

      // Сразу синхронизируем визуал (для мгновенного отклика)
      strikerEntry.mesh.position.set(clampedX, strikerSpawnY, getCurrentLineZ());

      // Проверяем пересечения с фишками
      validatePlacement(clampedX);
    }
  } else if (gameState === 'AIMING' && isAiming && strikerEntry) {
    updatePointerNDC(event);
    raycaster.setFromCamera(pointerNDC, camera);

    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      // Вычисляем вектор от битка до курсора (игрок тянет назад)
      const pullVector = new THREE.Vector3().subVectors(intersection, aimStartPoint);

      // Ограничиваем максимальную длину вектора
      if (pullVector.length() > PHYSICS.maxPullDistance) {
        pullVector.setLength(PHYSICS.maxPullDistance);
      }

      // Инвертируем: вектор удара направлен в противоположную сторону
      currentImpulse.copy(pullVector).multiplyScalar(-1);

      if (currentImpulse.lengthSq() > 0.00001) {
        aimLine.visible = true;
        aimLine.position.copy(strikerEntry.mesh.position);
        aimLine.position.y += 0.001; // Приподнимаем, чтобы не было Z-fighting

        aimLine.setDirection(currentImpulse.clone().normalize());
        // Длина линии пропорциональна силе натяжения
        aimLine.setLength(currentImpulse.length() * 2);
      } else {
        aimLine.visible = false;
      }
    }
  }
}

function onPointerUp() {
  if (gameState === 'PLACEMENT') {
    if (isDragging) {
      isDragging = false;
      // Возвращаем OrbitControls
      if (controls) controls.enabled = true;
    }
  } else if (gameState === 'AIMING') {
    if (isAiming) {
      isAiming = false;
      if (controls) controls.enabled = true;
      aimLine.visible = false;

      if (currentImpulse.lengthSq() > 0.00001) {
        // БУДИМ ВСЕ ФИШКИ НА СТОЛЕ ПЕРЕД УДАРОМ
        physicsBodies.forEach(b => { if (b.body && b.body.isEnabled()) b.body.wakeUp(); });

        // Применяем импульс
        const impulse = currentImpulse.clone().multiplyScalar(PHYSICS.strikerForce);
        strikerEntry.body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);

        // Переходим в состояние движения
        gameState = 'MOVING';
        checkSleepFrameCount = 0;
        console.log('🎱 State → MOVING: Удар произведён!');
      }
    }
  }
}

function updatePointerNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// --- ВАЛИДАЦИЯ ПЕРЕСЕЧЕНИЙ (2D Математика) ---

function validatePlacement(strikerX) {
  const strikerZ = getCurrentLineZ();
  const minDist = strikerPhysRadius + coinPhysRadius;
  let hasCollision = false;

  for (const entry of physicsBodies) {
    // Пропускаем сам биток
    if (entry === strikerEntry) continue;
    // Пропускаем удалённые/невидимые фишки
    if (!entry.body.isEnabled()) continue;

    const coinPos = entry.body.translation();
    // Проверка дистанции в плоскости XZ (2D)
    const dx = strikerX - coinPos.x;
    const dz = strikerZ - coinPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < minDist) {
      hasCollision = true;
      break;
    }
  }

  if (hasCollision) {
    // Биток наезжает на фишку — красный цвет + блокируем кнопку
    setStrikerOverlapVisual(true);
    setButtonDisabled(true);
  } else {
    // Всё чисто — нормальный цвет + разблокируем кнопку
    setStrikerOverlapVisual(false);
    setButtonDisabled(false);
  }
}

function setStrikerOverlapVisual(isOverlapping) {
  if (!strikerEntry) return;
  strikerEntry.mesh.traverse(child => {
    if (child.isMesh) {
      if (isOverlapping) {
        // Сохраняем оригинальный цвет при первом наезде
        if (!child.userData._origColor) {
          child.userData._origColor = child.material.color.getHex();
        }
        child.material.color.set(0xff3333);
        child.material.transparent = true;
        child.material.opacity = 0.6;
      } else {
        // Восстанавливаем оригинальный цвет
        if (child.userData._origColor !== undefined) {
          child.material.color.set(child.userData._origColor);
        }
        child.material.transparent = false;
        child.material.opacity = 1.0;
      }
    }
  });
}

function setupAimLine() {
  const dir = new THREE.Vector3(0, 0, -1);
  const origin = new THREE.Vector3(0, 0, 0);
  const length = 0.1;
  const hex = 0xff0000;

  aimLine = new THREE.ArrowHelper(dir, origin, length, hex, 0.02, 0.01);
  aimLine.visible = false;
  scene.add(aimLine);
}

// --- INIT ---
async function init() {
  await RAPIER.init();

  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  world = new RAPIER.World(gravity);
  world.timestep = PHYSICS.fixedTimeStep;            // Фиксированный шаг 1/240
  world.numSolverIterations = PHYSICS.solverIterations;
  world.integrationParameters.maxCcdSubsteps = PHYSICS.maxCcdSubsteps;

  await create3DScene(updatePhysics);
  const model = await loadModel('/models/carrom-draco.glb');
  if (!model) return;

  model.position.y = 0;

  setupPhysics(model);
  setupAimLine();

  // Прогоняем физику для "осаживания" фишек на поверхность стола
  // (гравитация усаживает всё на точные позиции; при 240Hz нужно больше итераций)
  for (let i = 0; i < 240; i++) {
    world.step();
  }
  // Синхронизируем визуал после settling
  physicsBodies.forEach(({ mesh, body }) => {
    if (body.isEnabled()) {
      const pos = body.translation();
      const rot = body.rotation();
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  });
  // Обновляем Y битка после settling (реальная высота покоя)
  if (strikerEntry) {
    strikerSpawnY = strikerEntry.body.translation().y;
  }

  // Создаём UI и контролы расстановки
  createUI();
  createScoreUI();
  setupPlacementControls();

  // Начальная валидация позиции
  if (strikerEntry) {
    const pos = strikerEntry.body.translation();
    validatePlacement(pos.x);
  }
}

// Главный цикл синхронизации физики и рендера
function updatePhysics() {
  if (!world) return;

  // В режиме PLACEMENT физика заморожена — биток перемещается программно,
  // а коллизии проверяются математически в validatePlacement()
  if (gameState !== 'PLACEMENT') {
    // === ФИКСИРОВАННЫЙ TIMESTEP С АККУМУЛЯТОРОМ ===
    // Гарантирует одинаковое поведение физики на любом фреймрейте (30, 60, 144 fps).
    // При 240Hz шаг = 4.16ms, биток на макс скорости пролетает ~2 см — меньше радиуса фишки.
    const now = performance.now() / 1000; // в секундах
    if (lastPhysicsTime === 0) lastPhysicsTime = now;
    let frameDelta = now - lastPhysicsTime;
    lastPhysicsTime = now;

    // Защита от spiral of death: если вкладка была свёрнута, не пытаемся догнать
    if (frameDelta > PHYSICS.fixedTimeStep * PHYSICS.maxSubSteps) {
      frameDelta = PHYSICS.fixedTimeStep * PHYSICS.maxSubSteps;
    }

    physicsAccumulator += frameDelta;

    let stepsThisFrame = 0;
    while (physicsAccumulator >= PHYSICS.fixedTimeStep && stepsThisFrame < PHYSICS.maxSubSteps) {
      // Ограничиваем скорость ВСЕХ тел перед каждым шагом (защита от туннелирования)
      clampAllBodiesSpeed();

      world.step();
      stepsThisFrame++;
      physicsAccumulator -= PHYSICS.fixedTimeStep;
    }

    if (stepsThisFrame > 0) {
      checkPocketIntersections();
    }
  }

  // --- ЛОГИКА ЗАВЕРШЕНИЯ ХОДА ---
  if (gameState === 'MOVING') {
    checkSleepFrameCount++;
    if (checkSleepFrameCount % 30 === 0) { // Проверяем каждую полсекунды (при 60fps)
      let allSleeping = true;
      for (const entry of physicsBodies) {
        if (entry.body.isEnabled() && entry.body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
          const linvel = entry.body.linvel();
          const angvel = entry.body.angvel();

          const speedSq = linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z;
          const rotSpeedSq = angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z;

          if (speedSq > 0.0001 || rotSpeedSq > 0.0001) {
            allSleeping = false;
            break;
          }
        }
      }

      if (allSleeping) {
        endTurn();
      }
    }
  }

  physicsBodies.forEach((entry) => {
    const { mesh, body } = entry;

    // В PLACEMENT биток управляется напрямую из drag-хендлера, пропускаем sync
    if (gameState === 'PLACEMENT' && entry === strikerEntry) return;

    // Если тело активно, копируем координаты из физики в визуал
    if (body.isEnabled()) {
      const position = body.translation();
      const rotation = body.rotation();

      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  });
}

/**
 * Ограничивает линейную скорость всех динамических тел.
 * Это КРИТИЧНО для предотвращения туннелирования: если тело движется быстрее,
 * чем radius / timestep, оно пролетит сквозь другие объекты.
 */
function clampAllBodiesSpeed() {
  const maxSpeed = PHYSICS.maxLinearSpeed;
  const maxSpeedSq = maxSpeed * maxSpeed;

  for (const entry of physicsBodies) {
    const body = entry.body;
    if (!body.isEnabled() || body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;

    const vel = body.linvel();
    const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;

    if (speedSq > maxSpeedSq) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      body.setLinvel({ x: vel.x * scale, y: vel.y * scale, z: vel.z * scale }, true);
    }
  }
}

function checkPocketIntersections() {
  physicsBodies.forEach((entry) => {
    const { mesh, body } = entry;
    if (!body.isEnabled()) return;

    const pos = body.translation();
    const vecPos = new THREE.Vector3(pos.x, 0, pos.z);

    // Проверяем, находится ли центр фишки над лузой, и запоминаем ближайший центр
    let isOverPocket = false;
    let nearestPocketCenter = null;
    let nearestDist = Infinity;
    for (let center of pocketCenters) {
      const dist = vecPos.distanceTo(center);
      if (dist < PHYSICS.pocketRadius * 0.8 && dist < nearestDist) {
        isOverPocket = true;
        nearestPocketCenter = center;
        nearestDist = dist;
      }
    }

    const collider = body.collider(0);

    if (collider) {
      if (isOverPocket) {
        // Если фишка только что оказалась над лузой
        if (!mesh.userData.isFalling) {
          collider.setCollisionGroups(MASK_COIN_FALLING); // Пол исчезает
          body.wakeUp(); // БУДИМ ФИШКУ, чтобы гравитация потянула ее вниз!
          mesh.userData.isFalling = true;
        }

        // === POCKET DRAG: Замедляем и притягиваем к центру лузы ===
        // Имитация проваливания: фишка теряет горизонтальную скорость и
        // «скатывается» к центру отверстия, не отскакивая от дальнего борта.
        const vel = body.linvel();

        // 1. Горизонтальное торможение (вертикальную скорость не трогаем — пусть падает)
        body.setLinvel({
          x: vel.x * PHYSICS.pocketDragFactor,
          y: vel.y,
          z: vel.z * PHYSICS.pocketDragFactor
        }, true);

        // 2. Притяжение к центру лузы (мягкая сила)
        if (nearestPocketCenter && nearestDist > 0.001) {
          const pullDir = {
            x: (nearestPocketCenter.x - pos.x) / nearestDist,
            z: (nearestPocketCenter.z - pos.z) / nearestDist
          };
          const pullStrength = PHYSICS.pocketPullForce * PHYSICS.fixedTimeStep;
          body.applyImpulse({
            x: pullDir.x * pullStrength,
            y: 0,
            z: pullDir.z * pullStrength
          }, true);
        }
      } else {
        // Если фишка балансировала на краю, но отскочила обратно на стол
        if (mesh.userData.isFalling) {
          collider.setCollisionGroups(MASK_COIN_NORMAL); // Пол снова твердый
          mesh.userData.isFalling = false;
        }
      }
    }

    // Окончательное удаление, когда фишка пролетела 10 см вниз
    if (pos.y < PHYSICS.pocketFallDepth) {
      console.log(`🕳️ Успешное попадание: ${mesh.userData.type}`);
      processPocketResult(entry);
      mesh.userData.isFalling = false; // Сбрасываем флаг
    }
  });
}

function processPocketResult(entry) {
  const { mesh, body } = entry;

  // Записываем события текущего удара в turnEvents
  const type = mesh.userData.type;
  if (type === 'striker') {
    turnEvents.isFoul = true;
  } else if (type === 'queen') {
    turnEvents.pocketedQueen = true;
  } else if (type === 'white' || type === 'black') {
    const ownColor = (currentPlayer === 1) ? 'white' : 'black';
    if (type === ownColor) {
      turnEvents.pocketedOwn++;
    } else {
      turnEvents.pocketedOpponent++;
    }
  }

  if (entry === strikerEntry) {
    // === БИТОК В ЛУЗЕ: не удаляем, а помечаем для восстановления ===
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.sleep();
    body.setEnabled(false);
    mesh.visible = false;
    mesh.userData.pocketed = true;
    console.log('⚠️ Биток попал в лузу! Будет восстановлен в следующем ходе.');
  } else {
    // === ФИШКА В ЛУЗЕ: удаляем со сцены ===
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.sleep();
    body.setEnabled(false);
    mesh.visible = false;
  }

  if (window.onPocketEnter) {
    window.onPocketEnter(mesh.userData.type, mesh.userData.id);
  }
}

function endTurn() {
  console.log('🎱 State → PLACEMENT: Ход завершен, оцениваем ход.');

  // Запускаем расчет очков и смену ходов
  evaluateTurn();

  // Поворачиваем камеру к текущему игроку
  rotateCameraForPlayer(currentPlayer);

  if (strikerEntry) {
    // Если биток был в лузе — восстанавливаем его
    if (strikerEntry.mesh.userData.pocketed || !strikerEntry.body.isEnabled()) {
      strikerEntry.body.setEnabled(true);
      strikerEntry.mesh.visible = true;
      strikerEntry.mesh.userData.pocketed = false;
      // Восстанавливаем маску коллизий (на случай если isFalling не сбросился)
      const collider = strikerEntry.body.collider(0);
      if (collider) collider.setCollisionGroups(MASK_COIN_NORMAL);
      console.log('🔄 Биток восстановлен из лузы.');
    }

    strikerEntry.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);

    // Сбрасываем скорости
    strikerEntry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    strikerEntry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // СБРОС ВРАЩЕНИЯ: возвращаем идеально ровное положение
    strikerEntry.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

    const resetPos = { x: 0, y: strikerSpawnY, z: getCurrentLineZ() };
    strikerEntry.body.setTranslation(resetPos, true);
    strikerEntry.body.setNextKinematicTranslation(resetPos, true);
    strikerEntry.mesh.position.set(resetPos.x, resetPos.y, resetPos.z);
    strikerEntry.mesh.quaternion.set(0, 0, 0, 1); // СБРОС ВИЗУАЛЬНОГО ВРАЩЕНИЯ (т.к. в PLACEMENT синхронизация отключена)

    validatePlacement(0);
  }

  gameState = 'PLACEMENT';
  updateButtonVisibility();

  // Сбрасываем аккумулятор для следующего хода
  lastPhysicsTime = 0;
  physicsAccumulator = 0;
}

// Главная функция настройки сцены
function setupPhysics(model) {
  const positions = new Array(19).fill(null);
  let strikerMesh = null;
  let coinTemplate = null;
  let boardTopY = 0.00; // Истинная математическая высота поверхности стола

  model.updateMatrixWorld(true);

  model.traverse((obj) => {
    // Поверхность стола (Идеальный единый кубоид + Бетонные борта с масками)
    if (obj.name === 'mesh_board_surface') {
      const bbox = new THREE.Box3().setFromObject(obj);
      boardTopY = 0.001;

      const minX = bbox.min.x;
      const maxX = bbox.max.x;
      const minZ = bbox.min.z;
      const maxZ = bbox.max.z;

      const widthX = maxX - minX;
      const widthZ = maxZ - minZ;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;

      // Сохраняем центры луз для математики
      const pr = PHYSICS.pocketRadius;
      pocketCenters = [
        new THREE.Vector3(maxX - pr, 0, maxZ - pr),
        new THREE.Vector3(maxX - pr, 0, minZ + pr),
        new THREE.Vector3(minX + pr, 0, maxZ - pr),
        new THREE.Vector3(minX + pr, 0, minZ + pr)
      ];

      const floorHalfHeight = 0.05;
      const floorCenterY = boardTopY - floorHalfHeight;

      const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorCenterY, 0);
      const floorBody = world.createRigidBody(floorBodyDesc);

      // === 1. ЕДИНЫЙ ПОЛ БЕЗ ШВОВ ===
      const mainCollider = RAPIER.ColliderDesc.cuboid(widthX / 2, floorHalfHeight, widthZ / 2)
        .setTranslation(cx, 0, cz)
        .setFriction(PHYSICS.friction)
        .setRestitution(0.1)
        .setCollisionGroups(MASK_FLOOR); // <--- Маска пола
      world.createCollider(mainCollider, floorBody);

      // === 2. БЕТОННЫЕ БОРТА ===
      const wt = 0.1; // Толщина борта 10 см
      const wh = 0.10; // Высота борта 10 см (5 см над столом + 5 см углубление)
      const wy = floorHalfHeight - 0.05;

      const wallTop = RAPIER.ColliderDesc.cuboid(widthX / 2 + wt, wh, wt / 2)
        .setTranslation(cx, wy, minZ - wt / 2)
        .setFriction(0.1).setRestitution(PHYSICS.boardRestitution)
        .setCollisionGroups(MASK_WALLS);
      world.createCollider(wallTop, floorBody);

      const wallBottom = RAPIER.ColliderDesc.cuboid(widthX / 2 + wt, wh, wt / 2)
        .setTranslation(cx, wy, maxZ + wt / 2)
        .setFriction(0.1).setRestitution(PHYSICS.boardRestitution)
        .setCollisionGroups(MASK_WALLS);
      world.createCollider(wallBottom, floorBody);

      const wallLeft = RAPIER.ColliderDesc.cuboid(wt / 2, wh, widthZ / 2 + wt)
        .setTranslation(minX - wt / 2, wy, cz)
        .setFriction(0.1).setRestitution(PHYSICS.boardRestitution)
        .setCollisionGroups(MASK_WALLS);
      world.createCollider(wallLeft, floorBody);

      const wallRight = RAPIER.ColliderDesc.cuboid(wt / 2, wh, widthZ / 2 + wt)
        .setTranslation(maxX + wt / 2, wy, cz)
        .setFriction(0.1).setRestitution(PHYSICS.boardRestitution)
        .setCollisionGroups(MASK_WALLS);
      world.createCollider(wallRight, floorBody);

      // === 3. НЕВИДИМАЯ КРЫШКА ===
      const roofHeight = 0.34;
      const roofBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, roofHeight, 0);
      const roofBody = world.createRigidBody(roofBodyDesc);
      const roofColliderDesc = RAPIER.ColliderDesc.cuboid(2.0, 0.01, 2.0)
        .setFriction(0.0)
        .setRestitution(0.2)
        .setCollisionGroups(MASK_WALLS);
      world.createCollider(roofColliderDesc, roofBody);

      if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
        // ==========================================
        // 🛠️ ВИЗУАЛЬНЫЙ ДЕБАГГИНГ (ПОЛ, БОРТА И ЛУЗЫ) 🛠️
        // ==========================================
        function drawDebugBox(w, h, d, x, y, z, color) {
          const geo = new THREE.BoxGeometry(w, h, d);
          const mat = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: 0.3
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, z);
          scene.add(mesh);
        }

        // Функция для отрисовки цилиндров луз
        function drawDebugCylinder(radius, height, x, y, z, color) {
          const geo = new THREE.CylinderGeometry(radius, radius, height, 32);
          const mat = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: 0.6
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, z);
          scene.add(mesh);
        }

        // 1. Один сплошной синий прямоугольник для пола
        drawDebugBox(widthX, floorHalfHeight * 2, widthZ, cx, floorCenterY, cz, 0x0088ff);

        // 2. Красные бетонные борта
        drawDebugBox(widthX + wt * 2, wh * 2, wt, cx, wy, minZ - wt / 2, 0xff0000);
        drawDebugBox(widthX + wt * 2, wh * 2, wt, cx, wy, maxZ + wt / 2, 0xff0000);
        drawDebugBox(wt, wh * 2, widthZ + wt * 2, minX - wt / 2, wy, cz, 0xff0000);
        drawDebugBox(wt, wh * 2, widthZ + wt * 2, maxX + wt / 2, wy, cz, 0xff0000);

        // 3. Зеленая крышка
        drawDebugBox(4.0, 0.02, 4.0, 0, roofHeight, 0, 0x00ff00);

        // 4. Фиолетовые зоны срабатывания луз (триггеры)
        const triggerRadius = PHYSICS.pocketRadius * 1;
        pocketCenters.forEach((pos) => {
          // Отрисовываем цилиндр высотой 10 см, чтобы его было хорошо видно сквозь стол
          drawDebugCylinder(triggerRadius, 0.1, pos.x, boardTopY, pos.z, 0xff00ff);
        });
        // ==========================================
      }
    }

    if (obj.name === 'mesh_carrom_man') {
      coinTemplate = obj;
      obj.visible = false;
    }
    if (obj.name.startsWith('pos_coin_')) {
      const index = parseInt(obj.name.replace('pos_coin_', ''));
      positions[index] = obj.getWorldPosition(new THREE.Vector3());
      obj.visible = false;
    }
    if (obj.name === 'mesh_striker') {
      strikerMesh = obj;
    }
  });

  // === ЖЕСТКАЯ НОРМАЛИЗАЦИЯ ФИШЕК ===
  const officialCoinDia = 0.0318;
  const officialCoinHalfHeight = 0.008 / 2; // Толщина 8 мм

  if (coinTemplate) {
    // Вытаскиваем фишку в корень сцены (отвязываем от групп Блендера)
    scene.add(coinTemplate);
    coinTemplate.scale.set(1, 1, 1);
    coinTemplate.updateMatrixWorld(true);

    // Измеряем и масштабируем до идеальных размеров
    const bbox = new THREE.Box3().setFromObject(coinTemplate);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    coinTemplate.scale.set(
      officialCoinDia / size.x,
      (officialCoinHalfHeight * 2) / size.y,
      officialCoinDia / size.z
    );
    coinTemplate.updateMatrixWorld(true);

    const boardCenter = positions[0] ? positions[0].clone() : new THREE.Vector3(0, 0, 0);
    // Точка отсчета для сетки — истинная поверхность стола
    boardCenter.y = boardTopY;

    // 45 градусов в радианах (Math.PI / 4)
    const rotation45 = -Math.PI / 4;
    const perfectPositions = getCarromPositions(boardCenter, officialCoinDia, rotation45);

    // Сохраняем физический радиус фишки для валидации
    coinPhysRadius = (officialCoinDia / 2) * 1;

    for (let i = 0; i < 19; i++) {
      const coinClone = coinTemplate.clone();
      coinClone.visible = true;
      scene.add(coinClone);

      coinClone.userData.id = i;
      if (i === 0) {
        coinClone.userData.type = 'queen';
        setMeshColor(coinClone, 0xff0000);
      } else {
        const isWhite = i % 2 === 0;
        coinClone.userData.type = isWhite ? 'white' : 'black';
        setMeshColor(coinClone, isWhite ? 0xbbbbbb : 0x444444);
      }

      const spawnPos = perfectPositions[i];
      // Origin в центре геометрии, значит центр фишки должен быть на halfHeight выше стола
      spawnPos.y = boardTopY + officialCoinHalfHeight + 0.0005;

      const physRadius = (officialCoinDia / 2) * 1; // Зазор для стабильности
      const body = createSimplePhysicsBody(physRadius, officialCoinHalfHeight, spawnPos);

      physicsBodies.push({ mesh: coinClone, body });
    }
  }

  // === ЖЕСТКАЯ НОРМАЛИЗАЦИЯ БИТКА ===
  if (strikerMesh) {
    const officialStrikerDia = 0.0413;
    const officialStrikerHalfHeight = 0.008 / 2;

    scene.add(strikerMesh);
    strikerMesh.scale.set(1, 1, 1);
    strikerMesh.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(strikerMesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    strikerMesh.scale.set(
      officialStrikerDia / size.x,
      (officialStrikerHalfHeight * 2) / size.y,
      officialStrikerDia / size.z
    );
    strikerMesh.updateMatrixWorld(true);

    strikerMesh.userData.id = 999;
    strikerMesh.userData.type = 'striker';

    // Спавн строго на базовой линии Игрока 1 (X = 0, Z = PLAYER_1_LINE_Z)
    strikerSpawnY = boardTopY + officialStrikerHalfHeight;
    const spawnPos = new THREE.Vector3(0, strikerSpawnY, getCurrentLineZ());

    strikerPhysRadius = (officialStrikerDia / 2) * 1;

    // В режиме PLACEMENT — kinematicPositionBased (не отталкивает фишки)
    const body = createKinematicPhysicsBody(strikerPhysRadius, officialStrikerHalfHeight, spawnPos);

    // Синхронизируем визуал с физикой сразу при спавне
    strikerMesh.position.copy(spawnPos);

    strikerEntry = { mesh: strikerMesh, body };
    physicsBodies.push(strikerEntry);
  }
}

// --- ФИЗИЧЕСКИЕ ХЕЛПЕРЫ ---

function createSimplePhysicsBody(radius, halfHeight, spawnPosition) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setCcdEnabled(true)
    .setLinearDamping(PHYSICS.damping)
    .setAngularDamping(PHYSICS.damping);

  const body = world.createRigidBody(bodyDesc);

  // Возвращаем обычный идеальный цилиндр! Никаких фасок.
  const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
    .setFriction(PHYSICS.friction)
    .setRestitution(PHYSICS.restitution)
    .setMass(PHYSICS.massCoin)
    .setCollisionGroups(MASK_COIN_NORMAL); // <--- Применяем маску

  world.createCollider(colliderDesc, body);
  return body;
}

/**
 * Создаёт kinematicPositionBased тело для битка в режиме PLACEMENT.
 * Оно перемещается программно через setNextKinematicTranslation(),
 * не отталкивает другие фишки и не подвержено гравитации.
 */
function createKinematicPhysicsBody(radius, halfHeight, spawnPosition) {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
    .setFriction(PHYSICS.friction)
    .setRestitution(PHYSICS.restitution)
    .setMass(PHYSICS.massStriker)
    .setCollisionGroups(MASK_COIN_NORMAL); // <--- Применяем маску

  world.createCollider(colliderDesc, body);
  return body;
}

// --- УТИЛИТЫ ---

function setMeshColor(obj, colorValue) {
  obj.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.color.set(colorValue);
    }
  });
}

window.onPocketEnter = (type, id) => {
  console.log(`🎯 Rules Engine: Объект типа ${type} (ID: ${id}) в лузе!`);
};

// Генерация идеального узора (шестиугольник)
function getCarromPositions(centerPos, diameter, rotationAngle = 0) {
  const gap = 0.0002; // Наш идеальный микро-зазор
  const d = diameter + gap;
  const positions = [];

  // 0: Центр (Королева)
  positions.push(new THREE.Vector3(centerPos.x, centerPos.y, centerPos.z));

  // 1-6: Внутреннее кольцо (шаг 60 градусов)
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + rotationAngle;
    positions.push(new THREE.Vector3(
      centerPos.x + Math.cos(angle) * d,
      centerPos.y,
      centerPos.z + Math.sin(angle) * d
    ));
  }

  // 7-18: Внешнее кольцо (12 фишек, шаг 30 градусов)
  // Идем строго по часовой/против часовой стрелки, поэтому цвета будут чередоваться 1 через 1
  const dSq3 = d * Math.sqrt(3);
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6 + rotationAngle;

    // Если четный шаг — это угол гексагона (дальше от центра). Нечетный — центр грани (ближе).
    const dist = (i % 2 === 0) ? (2 * d) : dSq3;

    positions.push(new THREE.Vector3(
      centerPos.x + Math.cos(angle) * dist,
      centerPos.y,
      centerPos.z + Math.sin(angle) * dist
    ));
  }

  return positions;
}

init();

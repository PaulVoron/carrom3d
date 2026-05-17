import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { create3DScene, loadModel, scene, camera, renderer, canvas, controls } from './3d-scene.js';

let world;
let physicsBodies = []; // Массив объектов: { mesh, body }
let pocketColliders = []; // Массив колайдеров луз

// Очередь для обработки падения фишек в лузу
const fallingQueue = new Map();

// === STATE MACHINE ===
let gameState = 'PLACEMENT'; // Состояния: PLACEMENT, AIMING, MOVING

// === STRIKER PLACEMENT CONSTANTS ===
const PLAYER_1_LINE_Z = 0.25;   // Фиксированная Z-координата базовой линии Игрока 1 (ближняя к камере, Z+)
const PLAYER_1_MIN_X = -0.20;   // Левая граница перемещения битка
const PLAYER_1_MAX_X = 0.20;    // Правая граница перемещения битка

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

// --- DRAG & DROP (PLACEMENT MODE) ---

function setupPlacementControls() {
  const domElement = renderer.domElement;

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
}

function onPointerDown(event) {
  if (gameState !== 'PLACEMENT' || !strikerEntry) return;

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
}

function onPointerMove(event) {
  if (gameState !== 'PLACEMENT' || !strikerEntry) return;
  if (!isDragging) return;

  updatePointerNDC(event);
  raycaster.setFromCamera(pointerNDC, camera);

  // Находим точку пересечения луча с горизонтальной плоскостью
  const intersection = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
    // Ограничиваем X в пределах базовой линии
    const clampedX = THREE.MathUtils.clamp(intersection.x, PLAYER_1_MIN_X, PLAYER_1_MAX_X);

    // Перемещаем физическое тело (kinematic) — Y и Z заблокированы
    strikerEntry.body.setNextKinematicTranslation(
      { x: clampedX, y: strikerSpawnY, z: PLAYER_1_LINE_Z },
      true
    );

    // Сразу синхронизируем визуал (для мгновенного отклика)
    strikerEntry.mesh.position.set(clampedX, strikerSpawnY, PLAYER_1_LINE_Z);

    // Проверяем пересечения с фишками
    validatePlacement(clampedX);
  }
}

function onPointerUp() {
  if (isDragging) {
    isDragging = false;
    // Возвращаем OrbitControls
    if (controls) controls.enabled = true;
  }
}

function updatePointerNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// --- ВАЛИДАЦИЯ ПЕРЕСЕЧЕНИЙ (2D Математика) ---

function validatePlacement(strikerX) {
  const strikerZ = PLAYER_1_LINE_Z;
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

// --- INIT ---

async function init() {
  await RAPIER.init();
  
  // Гравитация
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  world = new RAPIER.World(gravity);

  // Инициализируем визуальную сцену
  await create3DScene(updatePhysics);

  // Загружаем нашу идеальную модель
  const model = await loadModel('/models/carrom-draco.glb');
  if (!model) return;

  setupPhysics(model);
  setupPockets();

  // Прогоняем физику для "осаживания" фишек на поверхность стола
  // (гравитация усаживает всё на точные позиции за ~1 секунду симуляции)
  for (let i = 0; i < 60; i++) {
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
    world.step();
    checkPocketIntersections();
  }

  const currentTime = performance.now();

  physicsBodies.forEach((entry) => {
    const { mesh, body } = entry; 

    // Логика задержки (чтобы игрок увидел, как фишка проваливается в лузу)
    if (fallingQueue.has(body.handle)) {
      const fallStartTime = fallingQueue.get(body.handle);
      if (currentTime - fallStartTime > 250) {
        processPocketResult(entry);
        fallingQueue.delete(body.handle);
      }
    }

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

function checkPocketIntersections() {
  pocketColliders.forEach((pocketCollider) => {
    world.intersectionsWith(pocketCollider, (hitHandle) => {
      const bodyEntry = physicsBodies.find(b => b.body.handle === hitHandle);
      if (bodyEntry && !fallingQueue.has(hitHandle)) {
        fallingQueue.set(hitHandle, performance.now());
      }
      return true;
    });
  });
}

function setupPockets() {
  const halfSize = 0.735 / 2;
  const pocketRadius = 0.0445 / 2;
  const offset = halfSize - pocketRadius;

  const pocketPositions = [
    { x: offset, z: offset },
    { x: offset, z: -offset },
    { x: -offset, z: offset },
    { x: -offset, z: -offset }
  ];

  pocketPositions.forEach((pos) => {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, -0.02, pos.z);
    const body = world.createRigidBody(bodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.cylinder(0.01, pocketRadius).setSensor(true);
    const collider = world.createCollider(colliderDesc, body);
    pocketColliders.push(collider);
  });
}

function processPocketResult(entry) {
  const { mesh, body } = entry;
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.sleep();
  body.setEnabled(false);
  mesh.visible = false;

  if (window.onPocketEnter) {
    window.onPocketEnter(mesh.userData.type, mesh.userData.id);
  }
}

// Главная функция настройки сцены
function setupPhysics(model) {
  const positions = new Array(19).fill(null);
  let strikerMesh = null;
  let coinTemplate = null;
  let boardTopY = 0; // Истинная математическая высота поверхности стола

  model.updateMatrixWorld(true);

  model.traverse((obj) => {
    // Борта (Trimesh для правильного отскока)
    if (obj.name === 'mesh_board_frame') {
      createTrimeshBody(obj);
    }
    
    // Поверхность стола (Идеально гладкий физический куб)
    if (obj.name === 'mesh_board_surface') {
      // 1. Измеряем точную высоту верхней грани деревянной текстуры
      boardTopY = 0.002;

      const floorHalfHeight = 0.05; // Половина толщины пола (10см)
      const floorCenterY = boardTopY - floorHalfHeight; // Верхняя грань куба будет СТРОГО на boardTopY
      
      const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorCenterY, 0);
      const floorBody = world.createRigidBody(floorBodyDesc);
      
      const floorColliderDesc = RAPIER.ColliderDesc.cuboid(2.0, floorHalfHeight, 2.0)
        .setFriction(0.1)     // Очень низкое трение (имитация пудры)
        .setRestitution(0.1); // Гасим отскок от пола
      world.createCollider(floorColliderDesc, floorBody);
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
    coinPhysRadius = (officialCoinDia / 2) * 0.98;

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
      spawnPos.y = boardTopY + officialCoinHalfHeight;

      // 🧪 ТЕСТ: ставим фишку #1 на базовую линию битка
      if (i === 1) {
        spawnPos.x = 0.05;
        spawnPos.z = PLAYER_1_LINE_Z;
      }
      
      const physRadius = (officialCoinDia / 2) * 0.98; // Зазор для стабильности
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
    const spawnPos = new THREE.Vector3(0, strikerSpawnY, PLAYER_1_LINE_Z);

    strikerPhysRadius = (officialStrikerDia / 2) * 0.98;

    // В режиме PLACEMENT — kinematicPositionBased (не отталкивает фишки)
    const body = createKinematicPhysicsBody(strikerPhysRadius, officialStrikerHalfHeight, spawnPos);
    
    // Синхронизируем визуал с физикой сразу при спавне
    strikerMesh.position.copy(spawnPos);

    strikerEntry = { mesh: strikerMesh, body };
    physicsBodies.push(strikerEntry);
  }
}

// --- ФИЗИЧЕСКИЕ ХЕЛПЕРЫ ---

function createTrimeshBody(mesh) {
  const geometry = mesh.geometry.clone();
  mesh.updateMatrixWorld(true);
  geometry.applyMatrix4(mesh.matrixWorld);

  const vertices = new Float32Array(geometry.attributes.position.array);
  let indices = null;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  }

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
    .setFriction(0.1)     // Борта скользкие
    .setRestitution(0.5); // Хороший отскок фишек от бортов

  world.createCollider(colliderDesc, body);
  return body;
}

function createSimplePhysicsBody(radius, halfHeight, spawnPosition) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setCcdEnabled(true)     // Защита от проваливания сквозь стол
    .setLinearDamping(4.0)   // Мгновенная остановка (имитация трения)
    .setAngularDamping(4.0); 

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
    .setFriction(0.6)
    .setRestitution(0.1); 

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
    .setFriction(0.6)
    .setRestitution(0.1); 

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

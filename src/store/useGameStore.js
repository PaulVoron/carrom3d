/**
 * useGameStore.js
 * Глобальный стор на Zustand + Immer.
 *
 * Ключевой паттерн двойного доступа:
 *
 *   1. Из React-компонентов (с подпиской + ре-рендером):
 *      const score = useGameStore(s => s.score);
 *      const setPhase = useGameStore(s => s.setGamePhase);
 *
 *   2. Из RAF-цикла / Vanilla JS (БЕЗ ре-рендеров):
 *      import { useGameStore } from '../store/useGameStore';
 *      const { score, currentPlayer } = useGameStore.getState();
 *      useGameStore.getState().addScore(1, 2);
 *
 * Immer middleware позволяет мутировать state напрямую внутри set(),
 * не нарушая иммутабельность — черновик Immer сам создаёт новый объект.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ─── Константы ────────────────────────────────────────────────────────────────

/** @typedef {'PLACEMENT' | 'AIMING' | 'MOVING'} GamePhase */
/** @typedef {'on_board' | 'pocketed_uncovered' | 'covered'} QueenState */
/** @typedef {1 | 2} PlayerId */

// ─── Начальный стейт ──────────────────────────────────────────────────────────

const initialTurnEvents = () => ({
  pocketedWhite: 0,
  pocketedBlack: 0,
  pocketedQueen: false,
  isFoul: false,
  outOfBounds: [],
});

// ─── Стор ─────────────────────────────────────────────────────────────────────

export const useGameStore = create(
  immer((set, get) => ({

    // ── Состояние игры ──────────────────────────────────────────────────────
    /** @type {GamePhase} */
    gamePhase: 'PLACEMENT',

    /** @type {PlayerId} */
    currentPlayer: Math.random() > 0.5 ? 1 : 2,

    /** Счёт забитых фишек по цветам */
    score: {
      white: 0,
      black: 0,
    },

    /** Счетчик промахов подряд для предоставления второго шанса */
    consecutiveMisses: 0,

    /** Назначенные цвета игроков (white/black) */
    playerColors: {
      player1: null,
      player2: null,
    },

    /** Долги игроков (штрафные фишки) */
    dueDebt: {
      player1: 0,
      player2: 0,
    },

    /** @type {QueenState} */
    queenState: 'on_board',

    /** Кто закрыл Королеву (1 или 2, или null) */
    queenCoveredBy: null,

    /** Победитель (1 или 2, или null) */
    winner: null,
    showColorSelection: false,

    /** Итоговый счет победителя */
    gameOverScore: 0,

    /** События текущего хода — сбрасываются в endTurn() */
    turnEvents: initialTurnEvents(),

    /** Флаг: заблокирована ли кнопка подтверждения (коллизия при расстановке) */
    isPlacementBlocked: false,

    /** Флаг: идёт ли анимация камеры */
    isCameraAnimating: false,

    /** Флаг: инициализирована ли игра (показывать ли UI) */
    isReady: false,

    /** Язык интерфейса и голосовой озвучки ('uk' | 'en') */
    language: 'uk',

    // ── Сеть ───────────────────────────────────────────────────────────────
    /** @type {'local' | 'host' | 'client'} */
    networkMode: 'local',

    /** @type {'disconnected' | 'waiting' | 'connected'} */
    connectionStatus: 'disconnected',

    /** @type {string | null} */
    roomCode: null,

    /** @type {PlayerId | null} */
    localPlayerRole: null,

    /** @type {PlayerId | null} */
    lastStartingPlayer: null,

    /** @type {string | null} */
    colorAssignmentAlert: null,

    // ── Экшены ─────────────────────────────────────────────────────────────

    /** Инициализировать новую игру (жребий и сброс состояния) */
    initGame: (forceStartingPlayer = null) =>
      set((state) => {
        const start = forceStartingPlayer || (Math.random() > 0.5 ? 1 : 2);
        state.currentPlayer = start;
        state.lastStartingPlayer = start;
        state.score = { white: 0, black: 0 };
        state.playerColors = { player1: null, player2: null };
        state.dueDebt = { player1: 0, player2: 0 };
        state.queenState = 'on_board';
        state.queenCoveredBy = null;
        state.winner = null;
        state.gameOverScore = 0;
        state.consecutiveMisses = 0;
        state.turnEvents = initialTurnEvents();
        state.gamePhase = 'PLACEMENT';
        state.isPlacementBlocked = false;
        state.showColorSelection = false;
      }),

    /** Переключить фазу игры */
    setGamePhase: (/** @type {GamePhase} */ phase) =>
      set((state) => { state.gamePhase = phase; }),

    /** Задать текущего игрока */
    setCurrentPlayer: (/** @type {PlayerId} */ player) =>
      set((state) => { state.currentPlayer = player; }),

    /** Задать статус Королевы */
    setQueenState: (/** @type {QueenState} */ qs) =>
      set((state) => { state.queenState = qs; }),

    /** Заблокировать / разблокировать кнопку подтверждения расстановки */
    setPlacementBlocked: (/** @type {boolean} */ blocked) =>
      set((state) => { state.isPlacementBlocked = blocked; }),

    /** Отметить готовность сцены */
    setReady: (/** @type {boolean} */ ready) =>
      set((state) => { state.isReady = ready; }),

    /** Установить флаг анимации камеры */
    setCameraAnimating: (/** @type {boolean} */ animating) =>
      set((state) => { state.isCameraAnimating = animating; }),

    /** Установить язык озвучки */
    setLanguage: (/** @type {'uk' | 'en'} */ lang) =>
      set((state) => { state.language = lang; }),

    /** Установить сетевой режим */
    setNetworkMode: (/** @type {'local' | 'host' | 'client'} */ mode) =>
      set((state) => { state.networkMode = mode; }),

    /** Установить статус подключения */
    setConnectionStatus: (/** @type {'disconnected' | 'waiting' | 'connected'} */ status) =>
      set((state) => { state.connectionStatus = status; }),

    /** Установить код комнаты */
    setRoomCode: (/** @type {string | null} */ code) =>
      set((state) => { state.roomCode = code; }),

    /** Установить роль локального игрока */
    setLocalPlayerRole: (/** @type {PlayerId | null} */ role) =>
      set((state) => { state.localPlayerRole = role; }),

    clearColorAssignmentAlert: () => set((state) => { state.colorAssignmentAlert = null; }),

    /** Синхронизировать весь стор (используется Клиентом) */
    syncStoreState: (newState) => set((draft) => {
      draft.score = newState.score;
      draft.playerColors = newState.playerColors;
      draft.dueDebt = newState.dueDebt;
      draft.queenState = newState.queenState;
      draft.queenCoveredBy = newState.queenCoveredBy;
      draft.winner = newState.winner;
      draft.gameOverScore = newState.gameOverScore;
      draft.consecutiveMisses = newState.consecutiveMisses;
      draft.currentPlayer = newState.currentPlayer;
      draft.turnEvents = newState.turnEvents;
      draft.gamePhase = newState.gamePhase;
      draft.lastStartingPlayer = newState.lastStartingPlayer;
      draft.colorAssignmentAlert = newState.colorAssignmentAlert;
      draft.showColorSelection = newState.showColorSelection;
      draft.isPlacementBlocked = newState.isPlacementBlocked;
    }),

    // ── Ивенты хода ────────────────────────────────────────────────────────

    /** Записать событие попадания в лузу */
    recordPocket: (/** @type {'white' | 'black' | 'queen' | 'foul'} */ type) =>
      set((state) => {
        switch (type) {
          case 'white': state.turnEvents.pocketedWhite++; break;
          case 'black': state.turnEvents.pocketedBlack++; break;
          case 'queen': state.turnEvents.pocketedQueen = true; break;
          case 'foul': state.turnEvents.isFoul = true; break;
        }
      }),

    /** Записать вылет фишки за пределы стола */
    recordOutOfBounds: (/** @type {'striker' | 'white' | 'black' | 'queen'} */ type) =>
      set((state) => {
        if (type === 'striker') {
          // Вылет битка приравнивается к фолу
          state.turnEvents.isFoul = true;
        } else {
          // Обычные фишки просто возвращаются на стол без штрафов
          state.turnEvents.outOfBounds.push(type);
        }
      }),

    /** Назначить цвет игроку */
    selectPlayerColor: (color) =>
      set((state) => {
        const pKey = state.currentPlayer === 1 ? 'player1' : 'player2';
        const oppKey = state.currentPlayer === 1 ? 'player2' : 'player1';
        state.playerColors[pKey] = color;
        state.playerColors[oppKey] = color === 'white' ? 'black' : 'white';
        state.showColorSelection = false;
        state.isPlacementBlocked = false;
      }),

    /**
     * Вычислить результат хода и обновить стор.
     * Вызывается из GameRulesManager.evaluateTurn() после остановки физики.
     * Возвращает следующего игрока для удобства (без дополнительного getState()).
     * @returns {PlayerId}
     */
    evaluateTurn: ({ hitSomething = true } = {}) => {
      const state = get();
      const { currentPlayer, turnEvents, score, dueDebt, queenState, playerColors, queenCoveredBy } = state;
      const pKey = currentPlayer === 1 ? 'player1' : 'player2';
      const oppKey = currentPlayer === 1 ? 'player2' : 'player1';

      let newPlayerColors = { ...playerColors };
      let newScore = { ...score };
      let newDueDebt = { ...dueDebt };
      let newConsecutiveMisses = state.consecutiveMisses;
      let isFoul = turnEvents.isFoul;
      let nextQueenState = queenState;
      let nextQueenCoveredBy = queenCoveredBy;
      let coinsToReturn = { white: 0, black: 0 };
      let returns = [];

      // ─── 0. Назначение цвета ──────────────────────────────────────────────────
      let justAssignedColor = false;
      if (!newPlayerColors[pKey]) {
        // Назначаем цвет по большинству забитых фишек за удар (если нет ничьей)
        if (turnEvents.pocketedWhite > turnEvents.pocketedBlack) {
          newPlayerColors[pKey] = 'white';
          newPlayerColors[oppKey] = 'black';
          justAssignedColor = true;
        } else if (turnEvents.pocketedBlack > turnEvents.pocketedWhite) {
          newPlayerColors[pKey] = 'black';
          newPlayerColors[oppKey] = 'white';
          justAssignedColor = true;
        }
      }

      // После возможного назначения цвета, определяем "свои" и "чужие" забитые фишки в этот ход
      let ownColor = newPlayerColors[pKey];
      let ownPocketed = 0;
      let oppPocketed = 0;

      if (ownColor) {
        ownPocketed = ownColor === 'white' ? turnEvents.pocketedWhite : turnEvents.pocketedBlack;
        oppPocketed = ownColor === 'white' ? turnEvents.pocketedBlack : turnEvents.pocketedWhite;
      } else {
        // Если цвет всё ещё не назначен (например, забили и белую, и черную фишку),
        // то фишки просто остаются забитыми, но мы не можем использовать их для покрытия королевы или оплаты долга своими фишками.
        // Засчитаем их просто в общий счет (по цветам).
        // Но ownPocketed для логики правил (Королева, доп. ход) будет 0?
        // Вообще, если забил фишку, но цвета нет, ход переходит?
        // По правилам, если забил и белую, и черную, ход переходит, цвет не назначен.
        ownPocketed = 0; 
      }

      // ─── 1. Правила Королевы ──────────────────────────────────────────────────
      if (turnEvents.pocketedQueen) {
        // Если нет цвета (счет 0) или фол - вернуть королеву
        if (!ownColor || isFoul) {
          returns.push({ type: 'queen' });
          nextQueenState = 'on_board';
        } else {
          // Если цвет уже был назначен ДО этого удара, и игрок забил свою фишку в этот же удар - Королева покрывается сразу!
          if (!justAssignedColor && ownPocketed > 0) {
            nextQueenState = 'covered';
            nextQueenCoveredBy = currentPlayer;
          } else {
            // Иначе (первый удар в игре с выбором цвета, или своя фишка не забита) - Королева требует покрытия в следующий ход
            nextQueenState = 'pocketed_uncovered';
          }
        }
      } else if (queenState === 'pocketed_uncovered') {
        if (ownPocketed > 0 && !isFoul) {
          nextQueenState = 'covered';
          nextQueenCoveredBy = currentPlayer; // Тот, кто забил королеву в прошлый ход, сейчас покрыл её
        } else {
          // Проверяем, дается ли игроку второй шанс (дополнительный удар)
          const isSecondChance = !isFoul && !hitSomething && state.consecutiveMisses === 0;

          if (isSecondChance) {
            // Если дается второй шанс, Королева остается в состоянии pocketed_uncovered,
            // ее не нужно выставлять на стол!
            nextQueenState = 'pocketed_uncovered';
          } else {
            // Иначе (фол, удар с касанием без забития, или промах на втором шансе) - Королева возвращается
            returns.push({ type: 'queen' });
            nextQueenState = 'on_board';
          }
        }
      }

      // ─── 2. Штраф за забивание последней фишки (своей или чужой), если королева на столе ────────
      if (ownColor) {
        const oppColor = ownColor === 'white' ? 'black' : 'white';
        const currentOwnScore = newScore[ownColor];
        const currentOppScore = newScore[oppColor];

        // 2a. Своя последняя фишка
        if (currentOwnScore + ownPocketed >= 9 && nextQueenState !== 'covered') {
          isFoul = true;
          // Если королева была забита в этот же ход, она аннулируется
          if (turnEvents.pocketedQueen && nextQueenState !== 'on_board') {
            returns.push({ type: 'queen' });
            nextQueenState = 'on_board';
            nextQueenCoveredBy = null;
          }
        }

        // 2b. Чужая последняя фишка
        if (currentOppScore + oppPocketed >= 9 && nextQueenState !== 'covered') {
          isFoul = true;
          oppPocketed -= 1; // Отменяем забивание этой фишки
          returns.push({ type: 'coin', color: oppColor, count: 1 }); // Возвращаем чужую фишку на стол

          // Если королева была забита в этот же ход, она аннулируется
          if (turnEvents.pocketedQueen && nextQueenState !== 'on_board') {
            returns.push({ type: 'queen' });
            nextQueenState = 'on_board';
            nextQueenCoveredBy = null;
          }
        }
      }

      // Определяем факт успешного легального забивания своей фишки до списания долгов
      const didLegallyPocketOwn = ownColor && ownPocketed > 0 && !isFoul;

      // ─── 3. Фолы и долги ──────────────────────────────────────────────────────
      if (isFoul) {
        if (ownColor) {
          coinsToReturn[ownColor] += ownPocketed;
          ownPocketed = 0;

          // Штраф в 1 фишку
          if (newScore[ownColor] > 0) {
            newScore[ownColor] -= 1;
            coinsToReturn[ownColor] += 1;
          } else {
            newDueDebt[pKey] += 1;
          }
        } else {
          // Если цвета еще нет, но есть фол (забит биток) - долг начисляется
          newDueDebt[pKey] += 1;
        }
      } else {
        if (ownColor && newDueDebt[pKey] > 0 && ownPocketed > 0) {
          let payment = Math.min(newDueDebt[pKey], ownPocketed);
          newDueDebt[pKey] -= payment;
          ownPocketed -= payment;
          coinsToReturn[ownColor] += payment;
        }
      }

      // ─── 4. Обновление счета ──────────────────────────────────────────────────
      if (ownColor) {
        const oppColor = ownColor === 'white' ? 'black' : 'white';
        newScore[ownColor] += ownPocketed;
        newScore[oppColor] += oppPocketed;
        
        if (coinsToReturn[ownColor] > 0) {
          returns.push({ type: 'coin', color: ownColor, count: coinsToReturn[ownColor] });
        }
        if (coinsToReturn[oppColor] > 0) {
          returns.push({ type: 'coin', color: oppColor, count: coinsToReturn[oppColor] });
        }
      } else {
        // Если цвет не назначен, но забиты фишки, просто добавляем их в счет
        newScore.white += turnEvents.pocketedWhite;
        newScore.black += turnEvents.pocketedBlack;
      }

      // ─── 5. Возврат вылетевших за борт фишек ─────────────────────────────────
      turnEvents.outOfBounds.forEach(type => {
        if (type === 'queen') returns.push({ type: 'queen' });
        else returns.push({ type: 'coin', color: type, count: 1 });
      });

      // ─── 6. Передача хода и второй шанс при промахе ─────────────────────────
      let nextPlayer = currentPlayer;
      const didLegallyPocketQueen = turnEvents.pocketedQueen && ownColor && !isFoul;
      const isColorTie = !newPlayerColors[pKey] && turnEvents.pocketedWhite > 0 && turnEvents.pocketedWhite === turnEvents.pocketedBlack;
      
      if (isColorTie && !isFoul) {
        // Если ничья по цветам, ход гарантированно остается у игрока (он выбирает цвет)
        nextPlayer = currentPlayer;
        newConsecutiveMisses = 0;
      } else if (isFoul || didLegallyPocketOwn || didLegallyPocketQueen) {
        // При фоле или успешном забивании счетчик промахов сбрасывается
        newConsecutiveMisses = 0;
        if (isFoul || (!didLegallyPocketOwn && !didLegallyPocketQueen)) {
          nextPlayer = currentPlayer === 1 ? 2 : 1;
        }
      } else {
        // Если ничего не забито и нет фола - проверяем попадание по фишкам
        if (!hitSomething) {
          // Второй шанс, если ни по чему не попал (1 промах)
          if (newConsecutiveMisses === 0) {
            newConsecutiveMisses = 1;
            nextPlayer = currentPlayer; // остается тот же игрок
          } else {
            // Уже был промах, переход хода
            newConsecutiveMisses = 0;
            nextPlayer = currentPlayer === 1 ? 2 : 1;
          }
        } else {
          // Попал, но ничего не забил - обычный переход хода
          newConsecutiveMisses = 0;
          nextPlayer = currentPlayer === 1 ? 2 : 1;
        }
      }

      // ─── 7. Проверка на победу ────────────────────────────────────────────────
      let winner = null;
      let gameOverScore = 0;
      
      if (ownColor) {
        const oppColor = ownColor === 'white' ? 'black' : 'white';
        if (newScore[ownColor] === 9) {
          winner = currentPlayer;
          const opponentCoinsLeft = 9 - newScore[oppColor];
          const queenBonus = nextQueenCoveredBy === winner ? 3 : 0;
          gameOverScore = opponentCoinsLeft + queenBonus;
        } else if (newScore[oppColor] === 9) {
          // Игрок забил последнюю фишку соперника при покрытой королеве! Соперник побеждает.
          winner = currentPlayer === 1 ? 2 : 1;
          const playerCoinsLeft = 9 - newScore[ownColor];
          const queenBonus = nextQueenCoveredBy === winner ? 3 : 0;
          gameOverScore = playerCoinsLeft + queenBonus;
        }
      }

      set((draft) => {
        draft.score = newScore;
        draft.playerColors = newPlayerColors;
        draft.dueDebt = newDueDebt;
        draft.queenState = nextQueenState;
        draft.queenCoveredBy = nextQueenCoveredBy;
        draft.winner = winner;
        draft.gameOverScore = gameOverScore;
        draft.consecutiveMisses = newConsecutiveMisses;
        draft.currentPlayer = nextPlayer;
        draft.showColorSelection = isColorTie && !isFoul;
        if (isColorTie && !isFoul) {
          draft.isPlacementBlocked = true;
        }
        draft.turnEvents = initialTurnEvents();
        draft.gamePhase = 'PLACEMENT';
        if (justAssignedColor) {
          draft.colorAssignmentAlert = Date.now().toString();
        }
      });

      return { nextPlayer, returns, showColorSelection: isColorTie && !isFoul };
    },
  }))
);

// ─── Вспомогательные геттеры для Vanilla JS ───────────────────────────────────
// Используй эти функции внутри RAF-цикла, чтобы не создавать лишние подписки.

/** Получить текущую фазу игры без подписки */
export const getGamePhase = () => useGameStore.getState().gamePhase;

/** Получить текущего игрока без подписки */
export const getCurrentPlayer = () => useGameStore.getState().currentPlayer;

/** Записать событие хода из Vanilla JS */
export const recordPocket = (type) => useGameStore.getState().recordPocket(type);

/** Записать вылет за пределы из Vanilla JS */
export const recordOutOfBounds = (type) => useGameStore.getState().recordOutOfBounds(type);

/** Завершить ход из Vanilla JS, вернуть следующего игрока */
export const evaluateTurn = (params) => useGameStore.getState().evaluateTurn(params);

/** Получить сетевой режим */
export const getNetworkMode = () => useGameStore.getState().networkMode;

/** Получить статус подключения */
export const getConnectionStatus = () => useGameStore.getState().connectionStatus;

/** Получить текущий язык озвучки */
export const getLanguage = () => useGameStore.getState().language;

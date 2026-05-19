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

    /** Итоговый счет победителя */
    gameOverScore: 0,

    /** События текущего хода — сбрасываются в endTurn() */
    turnEvents: initialTurnEvents(),

    /** Флаг: заблокирована ли кнопка подтверждения (коллизия при расстановке) */
    isPlacementBlocked: false,

    /** Флаг: идёт ли анимация камеры */
    isCameraAnimating: false,

    /** Инициализирована ли игра (показывать ли UI) */
    isReady: false,

    // ── Экшены ─────────────────────────────────────────────────────────────

    /** Инициализировать новую игру (жребий и сброс состояния) */
    initGame: () =>
      set((state) => {
        state.currentPlayer = Math.random() > 0.5 ? 1 : 2;
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
      if (!newPlayerColors[pKey]) {
        // Если забиты только белые или только черные, назначаем цвет
        if (turnEvents.pocketedWhite > 0 && turnEvents.pocketedBlack === 0) {
          newPlayerColors[pKey] = 'white';
          newPlayerColors[oppKey] = 'black';
        } else if (turnEvents.pocketedBlack > 0 && turnEvents.pocketedWhite === 0) {
          newPlayerColors[pKey] = 'black';
          newPlayerColors[oppKey] = 'white';
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
          if (ownPocketed > 0) {
            nextQueenState = 'covered';
            nextQueenCoveredBy = currentPlayer;
          } else {
            nextQueenState = 'pocketed_uncovered';
          }
        }
      } else if (queenState === 'pocketed_uncovered') {
        if (ownPocketed > 0 && !isFoul) {
          nextQueenState = 'covered';
          nextQueenCoveredBy = currentPlayer; // Тот, кто забил королеву в прошлый ход, сейчас покрыл её
        } else {
          returns.push({ type: 'queen' });
          nextQueenState = 'on_board';
        }
      }

      // ─── 2. Штраф за забивание последней фишки, если королева на столе ────────
      if (ownColor) {
        const currentOwnScore = newScore[ownColor];
        if (currentOwnScore + ownPocketed >= 9 && nextQueenState !== 'covered') {
          isFoul = true;
          // Если королева была забита в этот же ход, она аннулируется
          if (turnEvents.pocketedQueen && nextQueenState !== 'on_board') {
            returns.push({ type: 'queen' });
            nextQueenState = 'on_board';
            nextQueenCoveredBy = null;
          }
        }
      }

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
      const didLegallyPocketOwn = ownPocketed > 0;
      const didLegallyPocketQueen = turnEvents.pocketedQueen && ownColor && !isFoul;
      
      if (isFoul || didLegallyPocketOwn || didLegallyPocketQueen) {
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
      
      if (ownColor && newScore[ownColor] === 9) {
        winner = currentPlayer;
        const oppColor = ownColor === 'white' ? 'black' : 'white';
        const opponentCoinsLeft = 9 - newScore[oppColor];
        const queenBonus = nextQueenCoveredBy === winner ? 3 : 0;
        gameOverScore = opponentCoinsLeft + queenBonus;
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
        draft.turnEvents = initialTurnEvents();
        draft.gamePhase = 'PLACEMENT';
      });

      return { nextPlayer, returns };
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

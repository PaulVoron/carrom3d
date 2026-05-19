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
  pocketedOwn: 0,
  pocketedOpponent: 0,
  pocketedQueen: false,
  isFoul: false,
});

// ─── Стор ─────────────────────────────────────────────────────────────────────

export const useGameStore = create(
  immer((set, get) => ({

    // ── Состояние игры ──────────────────────────────────────────────────────
    /** @type {GamePhase} */
    gamePhase: 'PLACEMENT',

    /** @type {PlayerId} */
    currentPlayer: 1,

    /** Счёт игроков */
    score: {
      player1: 0,
      player2: 0,
    },

    /** @type {QueenState} */
    queenState: 'on_board',

    /** События текущего хода — сбрасываются в endTurn() */
    turnEvents: initialTurnEvents(),

    /** Флаг: заблокирована ли кнопка подтверждения (коллизия при расстановке) */
    isPlacementBlocked: false,

    /** Флаг: идёт ли анимация камеры */
    isCameraAnimating: false,

    /** Инициализирована ли игра (показывать ли UI) */
    isReady: false,

    // ── Экшены ─────────────────────────────────────────────────────────────

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
    recordPocket: (/** @type {'own' | 'opponent' | 'queen' | 'foul'} */ type) =>
      set((state) => {
        switch (type) {
          case 'own':      state.turnEvents.pocketedOwn++;     break;
          case 'opponent': state.turnEvents.pocketedOpponent++; break;
          case 'queen':    state.turnEvents.pocketedQueen = true; break;
          case 'foul':     state.turnEvents.isFoul = true;     break;
        }
      }),

    /**
     * Вычислить результат хода и обновить стор.
     * Вызывается из GameRulesManager.evaluateTurn() после остановки физики.
     * Возвращает следующего игрока для удобства (без дополнительного getState()).
     * @returns {PlayerId}
     */
    evaluateTurn: () => {
      const state = get();
      const { currentPlayer, turnEvents, score, queenState } = state;
      let nextPlayer = currentPlayer;
      let nextQueenState = queenState;
      let newScore = { ...score };

      // ── Обновляем очки ─────────────────────────────────────────────────
      if (currentPlayer === 1) {
        newScore.player1 += turnEvents.pocketedOwn;
        newScore.player2 += turnEvents.pocketedOpponent;
      } else {
        newScore.player2 += turnEvents.pocketedOwn;
        newScore.player1 += turnEvents.pocketedOpponent;
      }

      // ── Статус Королевы ────────────────────────────────────────────────
      if (turnEvents.pocketedQueen) {
        if (turnEvents.pocketedOwn > 0 && !turnEvents.isFoul) {
          nextQueenState = 'covered';
        } else {
          nextQueenState = 'pocketed_uncovered';
        }
      } else if (queenState === 'pocketed_uncovered') {
        if (turnEvents.pocketedOwn > 0 && !turnEvents.isFoul) {
          nextQueenState = 'covered';
        }
      }

      // ── Смена хода ─────────────────────────────────────────────────────
      if (turnEvents.isFoul) {
        nextPlayer = currentPlayer === 1 ? 2 : 1;
      } else if (turnEvents.pocketedOwn > 0) {
        nextPlayer = currentPlayer; // Extra turn!
      } else {
        nextPlayer = currentPlayer === 1 ? 2 : 1;
      }

      // ── Атомарная запись в стор ────────────────────────────────────────
      set((draft) => {
        draft.score = newScore;
        draft.queenState = nextQueenState;
        draft.currentPlayer = nextPlayer;
        draft.turnEvents = initialTurnEvents();
        draft.gamePhase = 'PLACEMENT';
      });

      return nextPlayer;
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

/** Завершить ход из Vanilla JS, вернуть следующего игрока */
export const evaluateTurn = () => useGameStore.getState().evaluateTurn();

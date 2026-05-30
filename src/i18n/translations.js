/**
 * translations.js
 * Словарь локализации для Carrom 3D.
 * Поддерживаемые языки: 'uk' (Українська), 'en' (English).
 *
 * Использование:
 *   import { useTranslation } from '../i18n/translations';
 *   const { t } = useTranslation();
 *   t('menu.localGame') // => 'Локальна гра' | 'Local Game'
 */

// ─── Словарь ──────────────────────────────────────────────────────────────────

export const translations = {
  uk: {
    // ── Головне меню ──────────────────────────────────────────────────────────
    'menu.title':           'Carrom 3D',
    'menu.localGame':       'Локальна гра',
    'menu.createGame':      'Створити гру',
    'menu.joinGame':        'Приєднатися',
    'menu.or':              'Або онлайн',
    'menu.roomCodePlaceholder': 'Код',
    'menu.settings':        'Налаштування',
    'menu.waiting':         'Очікування суперника',
    'menu.roomCode':        'Код кімнати:',
    'menu.cancel':          'Скасувати',
    'menu.connecting':      'Підключення...',
    
    // ── Бот ───────────────────────────────────────────────────────────────────
    'bot.playVsBot':        'Грати проти Бота',
    'bot.difficulty':       'Складність бота',
    'bot.easy':             'Легкий',
    'bot.medium':           'Середній',
    'bot.master':           'Майстер',
    'bot.thinking':         'Бот думає...',

    // ── ScoreBoard ────────────────────────────────────────────────────────────
    'score.player':         'Гравець',
    'score.you':            'Ви',
    'score.opponent':       'Суперник',
    'score.colorWhite':     ' (Білі)',
    'score.colorBlack':     ' (Чорні)',
    'score.yourTurn':       'Ваш хід',
    'score.opponentTurn':   'Грає суперник',
    'score.turnPlayer':     'ХІД: ГРАВЕЦЬ',

    // ── GameOver Popup ────────────────────────────────────────────────────────
    'gameover.title':       'Гру закінчено!',
    'gameover.youWin':      'Ви перемогли!',
    'gameover.youLose':     'Переміг суперник',
    'gameover.playerWins':  'Переміг Гравець',
    'gameover.score':       'Рахунок:',
    'gameover.newGame':     'Нова гра',

    // ── Кнопка підтвердження розстановки ────────────────────────────────────────────
    'confirm.ready':        'Готовий до удару',

    // ── Поверніть пристрій ───────────────────────────────────────────────────────────
    'rotate.message':       'Будь ласка, поверніть пристрій у горизонтальне положення.',

    // ── Вибір кольору ───────────────────────────────────────────────────────────────
    'colorpick.title':      'Оберіть колір фішок',
    'colorpick.myTurn':     'Ви забили однакову кількість білих та чорних фішок. Оберіть свій колір:',
    'colorpick.opponentChoosing': 'Гравець {n} обирає колір...',
    'colorpick.white':      'Білі',
    'colorpick.black':      'Чорні',
    'colorpick.waiting':    'Очікування вибору суперника',

    // ── ColorAlert ─────────────────────────────────────────────────────────────────────
    'coloralert.player1White':  'Гравцю 1 призначено: Білі',
    'coloralert.player1Black':  'Гравцю 1 призначено: Чорні',
    'coloralert.youWhite':      'Ваш колір: Білі',
    'coloralert.youBlack':      'Ваш колір: Чорні',

    // ── Мережа ───────────────────────────────────────────────────────────────
    'network.opponentDisconnected': 'Суперник відключився.',
    'network.hostDisconnected':     'Хост відключився.',
    'network.createError':          'Помилка створення кімнати',
    'network.joinError':            'Не вдалося підключитися. Перевірте код.',

    // ── Налаштування (СеттингсМодал) ───────────────────────────────────────
    'settings.title':             'Налаштування',
    'settings.tabAudio':          'Аудіо & Мова',
    'settings.tabCustomization':  'Кастомізація',
    'settings.tabGameplay':       'Геймплей',
    'settings.close':             'Закрити',

    'settings.volumeMaster':      'Загальна гучність',
    'settings.volumeSfx':         'Звукові ефекти',
    'settings.volumeVoice':       'Голос',
    'settings.volumeUi':          'UI-звуки',

    'settings.language':          'Мова',
    'settings.langUk':            'Українська',
    'settings.langEn':            'English',

    // ── Налаштування геймплею ─────────────────────────────────────────────────────
    'settings.turnTimeLimit':     'Час на хід',
    'settings.turnTime.15':       '15 сек',
    'settings.turnTime.30':       '30 сек',
    'settings.turnTime.60':       '1 хв',
    'settings.turnTime.180':      '3 хв',
    'settings.turnTime.0':        'Безліміт',
    'settings.pyramidStyle':      'Збірка піраміди',
    'settings.pyramid.classic':   'Класика',
    'settings.pyramid.random':    'Рандом',

    // ── Visual PyramidRotator ────────────────────────────────────────────────────────
    'pyramid.rotate':             'Оберніть піраміду',
    'pyramid.apply':              'Застосувати',

    'settings.boardTexture':      'Текстура столу',
    'settings.frameTexture':      'Текстура бортів',
    'settings.strikerTexture':    'Текстура битка',
    'settings.coinColorSet':      'Набір кольорів фішок',
    'settings.environmentMap':    'HDR-оточення',

    // Опції скінів
    'skins.board.default':        'Класичний дерев\'яний',
    'skins.board.marble':         'Мармур',
    'skins.board.dark':           'Темний ебонос',

    'skins.frame.default':        'Натуральне дерево',
    'skins.frame.mahogany':       'Червоне дерево',
    'skins.frame.walnut':         'Горіх',

    'skins.striker.default':      'Слонова кістка',
    'skins.striker.gold':         'Золотий',
    'skins.striker.carbon':       'Карбон',

    'skins.coins.default':        'Класичний (чорно-білий)',
    'skins.coins.golden':         'Золото & срібло',
    'skins.coins.classic':        'Бежевий & коричневий',

    'skins.env.default':          'Студія',
    'skins.env.outdoor':          'Заміський будинок',
    'skins.env.night':            'Нічне місто',
  },

  en: {
    // ── Main Menu ─────────────────────────────────────────────────────────────
    'menu.title':           'Carrom 3D',
    'menu.localGame':       'Local Game',
    'menu.createGame':      'Create Game',
    'menu.joinGame':        'Join Game',
    'menu.or':              'Or online',
    'menu.roomCodePlaceholder': 'Code',
    'menu.settings':        'Settings',
    'menu.waiting':         'Waiting for opponent',
    'menu.roomCode':        'Room code:',
    'menu.cancel':          'Cancel',
    'menu.connecting':      'Connecting...',

    // ── Bot ───────────────────────────────────────────────────────────────────
    'bot.playVsBot':        'Play vs Bot',
    'bot.difficulty':       'Bot Difficulty',
    'bot.easy':             'Easy',
    'bot.medium':           'Medium',
    'bot.master':           'Master',
    'bot.thinking':         'Bot is thinking...',

    // ── ScoreBoard ────────────────────────────────────────────────────────────
    'score.player':         'Player',
    'score.you':            'You',
    'score.opponent':       'Opponent',
    'score.colorWhite':     ' (White)',
    'score.colorBlack':     ' (Black)',
    'score.yourTurn':       'Your turn',
    'score.opponentTurn':   'Opponent\'s turn',
    'score.turnPlayer':     'TURN: PLAYER',

    // ── GameOver Popup ────────────────────────────────────────────────────────
    'gameover.title':       'Game Over!',
    'gameover.youWin':      'You won!',
    'gameover.youLose':     'Opponent won',
    'gameover.playerWins':  'Player wins',
    'gameover.score':       'Score:',
    'gameover.newGame':     'New Game',

    // ── Кнопка підтвердження розстановки ────────────────────────────────────────────
    'confirm.ready':        'Ready to Strike',

    // ── Rotate Device ─────────────────────────────────────────────────────────────────
    'rotate.message':       'Please rotate your device to landscape.',

    // ── Солор Selection ───────────────────────────────────────────────────────────
    'colorpick.title':      'Choose Coin Color',
    'colorpick.myTurn':     'You pocketed equal white and black coins. Choose your color:',
    'colorpick.opponentChoosing': 'Player {n} is choosing...',
    'colorpick.white':      'White',
    'colorpick.black':      'Black',
    'colorpick.waiting':    'Waiting for opponent\'s choice',

    // ── ColorAlert ─────────────────────────────────────────────────────────────────────
    'coloralert.player1White':  'Player 1 assigned: White',
    'coloralert.player1Black':  'Player 1 assigned: Black',
    'coloralert.youWhite':      'Your color: White',
    'coloralert.youBlack':      'Your color: Black',

    // ── Network ───────────────────────────────────────────────────────────────
    'network.opponentDisconnected': 'Opponent disconnected.',
    'network.hostDisconnected':     'Host disconnected.',
    'network.createError':          'Failed to create room',
    'network.joinError':            'Failed to connect. Check the code.',

    // ── Settings (SettingsModal) ─────────────────────────────────────────────
    'settings.title':             'Settings',
    'settings.tabAudio':          'Audio & Language',
    'settings.tabCustomization':  'Customization',
    'settings.tabGameplay':       'Gameplay',
    'settings.close':             'Close',

    'settings.volumeMaster':      'Master Volume',
    'settings.volumeSfx':         'Sound Effects',
    'settings.volumeVoice':       'Voice',
    'settings.volumeUi':          'UI Sounds',

    'settings.language':          'Language',
    'settings.langUk':            'Ukrainian',
    'settings.langEn':            'English',

    // ── Gameplay Settings ──────────────────────────────────────────────────────
    'settings.turnTimeLimit':     'Turn Time Limit',
    'settings.turnTime.15':       '15 sec',
    'settings.turnTime.30':       '30 sec',
    'settings.turnTime.60':       '1 min',
    'settings.turnTime.180':      '3 min',
    'settings.turnTime.0':        'Unlimited',
    'settings.pyramidStyle':      'Pyramid Style',
    'settings.pyramid.classic':   'Classic',
    'settings.pyramid.random':    'Random',

    // ── PyramidRotator ─────────────────────────────────────────────────────────
    'pyramid.rotate':             'Rotate Pyramid',
    'pyramid.apply':              'Apply',

    'settings.boardTexture':      'Board Texture',
    'settings.frameTexture':      'Frame Texture',
    'settings.strikerTexture':    'Striker Texture',
    'settings.coinColorSet':      'Coin Color Set',
    'settings.environmentMap':    'HDR Environment',

    // Skin options
    'skins.board.default':        'Classic Wood',
    'skins.board.marble':         'Marble',
    'skins.board.dark':           'Dark Ebony',

    'skins.frame.default':        'Natural Wood',
    'skins.frame.mahogany':       'Mahogany',
    'skins.frame.walnut':         'Walnut',

    'skins.striker.default':      'Ivory',
    'skins.striker.gold':         'Gold',
    'skins.striker.carbon':       'Carbon Fiber',

    'skins.coins.default':        'Classic (Black & White)',
    'skins.coins.golden':         'Gold & Silver',
    'skins.coins.classic':        'Beige & Brown',

    'skins.env.default':          'Studio',
    'skins.env.outdoor':          'Country House',
    'skins.env.night':            'Night City',
  },
};

// ─── Хук useTranslation ───────────────────────────────────────────────────────

import { useGameStore } from '../store/useGameStore';

/**
 * React-хук для получения функции перевода t(key).
 * Подписывается на изменение языка в Zustand — ре-рендер автоматический.
 *
 * @returns {{ t: (key: string, fallback?: string) => string, language: 'uk' | 'en' }}
 */
export function useTranslation() {
  const language = useGameStore((state) => state.language);
  const dict = translations[language] ?? translations['uk'];

  /**
   * @param {string} key        — ключ перевода (напр. 'menu.localGame')
   * @param {string} [fallback] — что вернуть если ключ не найден
   */
  const t = (key, fallback = key) => dict[key] ?? fallback;

  return { t, language };
}

/**
 * Vanilla-JS версия перевода (без хука, без подписки).
 * Использовать там где нет React-контекста.
 * @param {string} key
 * @returns {string}
 */
export function translate(key) {
  const lang = useGameStore.getState().language ?? 'uk';
  const dict = translations[lang] ?? translations['uk'];
  return dict[key] ?? key;
}

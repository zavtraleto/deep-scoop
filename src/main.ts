import * as config from './core/config';
import { Game } from './core/game';

const game = new Game(document.getElementById('game')!);
game.start();

// Отладка из консоли в dev-сборке: window.game, window.config.
if (import.meta.env.DEV) Object.assign(window, { game, config });

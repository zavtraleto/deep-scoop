import { loadArtLibrary } from './collect/objectArt';
import * as config from './core/config';
import { Game } from './core/game';

const container = document.getElementById('game')!;
const loading = document.getElementById('loading');

// Картинки объектов грузятся до старта уровня: маска стирания строится из их альфы.
const arts = await loadArtLibrary();
loading?.remove();
const game = new Game(container, arts);
game.start();

// Отладка из консоли в dev-сборке: window.game, window.config.
if (import.meta.env.DEV) Object.assign(window, { game, config });

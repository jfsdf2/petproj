// 3D-герой Dota 2 на фоне страницы через библиотеку dota-loadout (<dota-hero>).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import 'dota-loadout/element';
import './Hero3D.css';

// id героя из каталога ассетов (assets/heroes/<id>/hero.json)
const HERO_ID = 'broodmother';

// Откуда грузятся модели: "/" — свои файлы из frontend/public/heroes/
const ASSETS_URL = '/';

// Вращение перетаскиванием (ЛКМ) работает штатным обработчиком библиотеки dota-loadout:
// она реализует физику самой игры (константы DRAG = 0.008, EASE = 10, GLIDE = 3.5) —
// экспоненциальное сглаживание к целевому углу и инерционное «докручивание» после
// отпускания мыши.
//
// Колесо мыши обрабатываем сами (wheel="false"), потому что штатный обработчик
// библиотеки крутит модель на фиксированный шаг и экспоненциально догоняет цель
// (см. ниже) — из-за этого скорость всё время скачет. Дельта в пикселях страницы
// (deltaMode = 2) тоже учитываем сами.
//
// Ключевое отличие от прошлой версии. Колесо НЕ двигает turn.target библиотеки:
// в её кадре угол экспоненциально подходит к цели
// (`angle += (target - angle) * (1 - exp(-EASE*dt))`, EASE = 10), поэтому за один
// щелчок модель сначала «прыгает» (пик скорости сотни градусов в секунду), а потом
// почти стоит — скорость всё время разная. Это и было «сначала очень быстро,
// потом очень медленно».
//
// Вместо этого колесо крутит ОТДЕЛЬНЫЙ пивот (THREE.Group) над turntable:
// pivot.rotation.y = наш угол, а turntable.rotation.y = угол библиотеки (перетаскивание).
// Оба вращения складываются. Угол пивота мы считаем сами, прибавляя КОНСТАНТНУЮ
// угловую скорость каждый кадр, поэтому во время прокрутки модель всегда крутится
// с одной и той же скоростью — как в игре. Скорость набирается и сбрасывается
// быстро, чтобы не было рывка на старте и долгого хвоста в конце.

// Постоянная скорость вращения колесом.
// Скорость одна и та же во время всего вращения: модель не «прыгает» на старте
// и не замирает в конце, а крутится ровно.
//   WHEEL_SPIN_SPEED — постоянная скорость вращения (рад/с);
//   WHEEL_SPIN_TIME — сколько секунд вращения даёт один пиксель прокрутки:
//     щелчок колеса ≈ 120 px ≈ 0.14 с вращения ≈ 30° (при скорости 3.6 рад/с);
//   WHEEL_SPIN_FRICTION — скорость затухания инерции (1/с) после истечения
//     времени вращения, чтобы модель плавно останавливалась «как по льду».
const WHEEL_SPIN_SPEED = 3.6; // рад/с (≈ 206 °/с)
const WHEEL_SPIN_TIME = 0.0012; // с на пиксель прокрутки
const WHEEL_SPIN_FRICTION = 5; // 1/с — затухание инерции

// Предел длительности вращения: сколько бы ни прокручивали, модель крутится
// не дольше этого времени подряд (иначе колесо «залипает»).
const MAX_SPIN_TIME = 3; // с

// Запас рамки поверх бокса модели (съедает покачивание idle-анимации)
const FRAME_MARGIN = 1.2;

// Фиксированный размер модели на экране в пикселях по ограничивающей оси:
// модель не растёт/не сжимается при изменении окна (800/1.2 ≈ 667 px)
const MODEL_PIXELS = 800;

// Верхний предел зума камеры (как в библиотеке) — базовый размер модели не обрезается
const ZOOM_LIMIT = 3;

// Полярный угол камеры: смотрим на модель сверху (в градусах)
const CAMERA_ELEVATION = 13 * Math.PI / 180;

// Ширина окна героя: 50% экрана, не уже 760 и не шире 1280 px
const BOX_WIDTH = 'clamp(50vw, 760px, 1280px)';

export default function Hero3D() {
  const [ready, setReady] = useState(false);
  const wrapRef = useRef(null);
  const heroRef = useRef(null);
  const viewerRef = useRef(null);
  // Состояние вращения колесом живёт в ref, а не внутри эффекта: патч кадра
  // библиотеки (viewer.frame) остаётся на экземпляре viewer и ссылается именно
  // на этот объект. Объект, созданный внутри эффекта, при повторном запуске
  // эффекта (React StrictMode) оказался бы потерянным: патч уже установлен и
  // второй вызов его не переустанавливает — колесо перестало бы крутить модель.
  const wheelRef = useRef(null);
  if (wheelRef.current == null) {
    wheelRef.current = {
      canvas: null, // холст, на котором слушаем колесо
      pivot: null, // наш пивот над turntable
      turntable: null, // turntable, к которому привязан пивот
      angle: 0, // накопленный угол пивота (рад)
      speed: 0, // текущая угловая скорость (рад/с)
      dir: 0, // направление: -1, 1 или 0 (стоп)
      left: 0, // сколько секунд ещё крутиться
      last: 0 // время последнего кадра (мс)
    };
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const heroElement = heroRef.current;
    if (!wrap || !heroElement) {
      return;
    }

    // Убирает подставку и пропсы: оставляет только героя (первого ребёнка стола)
    const stripTurntable = (viewer) => {
      const children = viewer.hero.turntable.children;
      for (let i = 1; i < (children?.length || 0); i += 1) {
        children[i].visible = false;
      }
    };

    // Полярный угол камеры: поднимаем вид над моделью, свет пересчитываем
    const applyElevation = (viewer) => {
      const basePlace = viewer.place.bind(viewer);
      viewer.place = () => {
        basePlace();
        const camera = viewer.camera;
        const { x: cx, y: cy, z: cz } = viewer.view.center;
        const distance = camera.position.distanceTo(viewer.view.center);
        const sin = Math.sin(CAMERA_ELEVATION);
        const cos = Math.cos(CAMERA_ELEVATION);
        camera.position.set(cx, cy + distance * sin, cz + distance * cos);
        camera.lookAt(cx, cy, cz);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        const view = camera.matrixWorldInverse;
        viewer.light.uLightDir.value.copy(viewer.toLight).transformDirection(view);
        viewer.light.uAmbientDir.value.copy(viewer.ambientDir).transformDirection(view);
        viewer.light.uUp.value.set(0, 1, 0).transformDirection(view);
      };
    };

    // Базовый зум, при котором модель занимает MODEL_PIXELS по ограничивающей оси.
    // Рассчитывается от view.size (уже с запасом FRAME_MARGIN) и текущего размера окна,
    // поэтому не зависит от того, когда вызывается: при загрузке и при ресайзе.
    const baseZoomFor = (viewer) => {
      const size = viewer.view.size;
      const width = viewer.canvas.clientWidth;
      const height = viewer.canvas.clientHeight;
      if (!size || !width || !height) {
        return 1;
      }
      const tanV = Math.tan(THREE.MathUtils.degToRad(15));
      const tanH = tanV * (width / height);
      const depth = Math.max(size.x, size.z) / 2;
      const distance =
        Math.max(0.62 * size.y / tanV, 0.68 * Math.max(size.x, size.z) / tanH) + depth;
      const fracW = size.x / (2 * tanH * distance);
      const fracH = size.y / (2 * tanV * distance);
      // Ось, что ограничивает кадр, и её текущий размер в пикселях
      const frac = Math.max(fracW, fracH);
      const axisPixels = frac === fracW ? width : height;
      return MODEL_PIXELS / (frac * axisPixels);
    };

    // Применяет базовый зум: модель занимает MODEL_PIXELS по ограничивающей оси
    const applyZoom = (viewer) => {
      const base = baseZoomFor(viewer);
      viewer.view.zoomTarget = THREE.MathUtils.clamp(base, 0.3, ZOOM_LIMIT);
      return base;
    };

    // Ставит камеру так, чтобы модель на экране была фиксированного размера
    // (MODEL_PIXELS по ограничивающей оси) независимо от размеров окна.
    const frameTo = (viewer, box) => {
      const size = box.getSize(new THREE.Vector3());
      if (size.lengthSq() === 0) {
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      // Рамка с запасом: посадка камеры библиотеки работает именно с этим размером
      const viewSize = size.clone().multiplyScalar(FRAME_MARGIN);
      viewer.view.size.copy(viewSize);
      viewer.view.center.copy(center);
      applyZoom(viewer);
      viewer.fit();
    };

    const onLoad = () => {
      const viewer = heroElement.viewer;
      if (!viewer?.hero) {
        return;
      }
      viewerRef.current = viewer;

      stripTurntable(viewer);
      applyElevation(viewer);

      // Сразу переходим на idle-анимацию: спавн смещает рамку во время появления
      const animations = viewer.hero.animations || [];
      const idle = animations.find((a) => a.loop && /LOADOUT/.test(a.activity)) || animations[0];
      if (idle && viewer.hero.playing !== idle.name) {
        viewer.play(idle.name);
      }

      // Одна стабильная рамка по боксу библиотеки — без пересъёмки кадра
      frameTo(viewer, viewer.hero.heroBox);
      setReady(true);
    };

    heroElement.addEventListener('load', onLoad);
    if (heroElement.viewer?.hero) {
      onLoad();
    }

    // При изменении размера окна модель сохраняет свой размер в пикселях
    const resizeObserver = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (viewer?.hero) {
        applyZoom(viewer);
      }
    });
    resizeObserver.observe(heroElement);

    // Вращение колесом: постоянная скорость.
    // Колесо крутит ОТДЕЛЬНЫЙ пивот над turntable (viewer.hero.turntable), а не
    // меняет turn.target библиотеки. Причина: библиотека ведёт угол к цели
    // экспоненциально (`angle += (target - angle) * (1 - exp(-EASE*dt))`, EASE = 10),
    // поэтому за один щелчок модель сначала резко «прыгает», а потом почти стоит —
    // скорость скачет. Своим пивотом мы задаём скорость сами: каждый кадр
    // прибавляем к углу speed * dt, и скорость всегда одна и та же.
    // Вращение перетаскиванием продолжает работать штатно (turntable.rotation.y).
    //
    // Состояние живёт в wheelRef (объект переживает перезапуск эффекта в
    // StrictMode): патч кадра библиотеки остаётся на экземпляре viewer и ссылается
    // именно на этот объект.
    const spin = () => wheelRef.current;

    // Ставит пивот над turntable: turntable становится ребёнком пивота, поэтому
    // вращения складываются (наш угол + угол библиотеки от перетаскивания).
    // Пивот живёт в той же точке, что и turntable (начало координат), поэтому
    // поворот вокруг Y выглядит ровно так же, как поворот самого turntable.
    const attachPivot = (viewer) => {
      const turntable = viewer.hero?.turntable;
      if (!turntable || !turntable.parent) {
        return;
      }
      const s = spin();
      if (s.pivot && s.turntable === turntable && turntable.parent === s.pivot) {
        return;
      }
      detachPivot(viewer);
      const parent = turntable.parent;
      const index = parent.children.indexOf(turntable);
      const pivot = new THREE.Group();
      pivot.name = 'wheel-pivot';
      parent.add(pivot);
      // Пивот встаёт на место turntable в списке детей сцены: при отсоединении
      // модель вернётся ровно туда же (порядок прозрачных объектов важен).
      if (index >= 0) {
        parent.children.splice(parent.children.indexOf(pivot), 1);
        parent.children.splice(index, 0, pivot);
      }
      pivot.add(turntable);
      s.pivot = pivot;
      s.turntable = turntable;
      // Накопленный угол сохраняем: пивот мог быть снят и поставлен заново
      // (перезапуск эффекта, StrictMode) — модель не должна прыгать.
      pivot.rotation.y = s.angle;
    };

    // Снимает пивот и возвращает turntable в сцену. Это нужно библиотеке:
    // при выгрузке модели она делает scene.remove(hero.turntable), а после
    // репарента turntable лежит в пивоте, и сцена его не убрала бы.
    const detachPivot = (viewer) => {
      const s = spin();
      const pivot = s.pivot;
      if (!pivot) {
        return;
      }
      const turntable = s.turntable || pivot.children[0];
      if (turntable) {
        // Возвращаем на то же место в сцене, где turntable был: порядок
        // отрисовки прозрачных объектов зависит от него.
        const scene = pivot.parent || viewer.scene;
        const index = scene.children.indexOf(pivot);
        turntable.parent?.remove(turntable);
        if (index >= 0) {
          scene.children.splice(index, 0, turntable);
        } else {
          scene.add(turntable);
        }
        // Локальное положение turntable не трогаем: библиотека сама пишет в
        // turntable.rotation.y угол перетаскивания, и сброс дал бы рывок.
      }
      pivot.parent?.remove(pivot);
      s.pivot = null;
      s.turntable = null;
      // Накопленный угол (s.angle) сохраняем: пивот может быть поставлен заново,
      // и модель не должна прыгать обратно.
      s.speed = 0;
      s.dir = 0;
      s.left = 0;
    };

    // Перетаскивание мышью имеет приоритет: вращение колеса останавливается,
    // чтобы оно не мешало вращению «в руках». Скорость не обнуляем резко —
    // она сама сойдёт на ноль по трению.
    const stopSpin = () => {
      const s = spin();
      s.dir = 0;
      s.left = 0;
    };

    // Каждый кадр: скорость плавно набирается (или сбрасывается), а угол пивота
    // растёт на speed * dt. Пока идёт прокрутка — скорость ровно одна.
    const stepSpin = (dt) => {
      const s = spin();
      // Остаток времени вращения убывает: прокрутка закончилась — модель тормозит.
      if (s.left > 0) {
        s.left = Math.max(0, s.left - dt);
        if (s.left === 0) {
          s.dir = 0;
        }
      }
      if (s.dir !== 0) {
        s.speed = s.dir * WHEEL_SPIN_SPEED;
      } else {
        s.speed *= Math.exp(-WHEEL_SPIN_FRICTION * dt);
        if (Math.abs(s.speed) < 1e-4) {
          s.speed = 0;
        }
      }
      s.angle += s.speed * dt;
      if (s.pivot) {
        s.pivot.rotation.y = s.angle;
        // Матрицу пивота обновляем сразу: ниже библиотека считает
        // turntable.updateMatrixWorld(true), а тот берёт матрицу родителя (пивота).
        // Без этого пивот отставал бы на кадр, и модель «отъезжала» от экрана
        // на первом кадре после прокрутки.
        s.pivot.updateMatrixWorld(true);
      }
    };

    // Шаг вращения встраиваем в кадр библиотеки: тогда угол попадает в рендер
    // в том же кадре, без задержки в один кадр (свой rAF так не умеет).
    const patchFrame = (viewer) => {
      if (viewer.__wheelFramePatched) {
        return;
      }
      viewer.__wheelFramePatched = true;
      const original = viewer.frame.bind(viewer);
      viewer.frame = () => {
        const s = spin();
        const now = performance.now();
        const dt = s.last ? Math.min((now - s.last) / 1000, 0.1) : 0;
        s.last = now;
        if (dt > 0) {
          stepSpin(dt);
        }
        original();
      };
    };

    // Выгрузка модели библиотекой: она убирает hero.turntable из сцены, но
    // после нашего репарента turntable лежит в пивоте. Поэтому перед выгрузкой
    // возвращаем turntable в сцену, а сам пивот убираем.
    const patchUnload = (viewer) => {
      if (viewer.__wheelUnloadPatched) {
        return;
      }
      viewer.__wheelUnloadPatched = true;
      const original = viewer.unload.bind(viewer);
      viewer.unload = () => {
        detachPivot(viewer);
        original();
      };
    };

    const onWheel = (event) => {
      const viewer = viewerRef.current;
      if (!viewer?.hero) {
        return;
      }
      const canvas = viewer.canvas;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }
      // Крутим только когда курсор над героем — так же, как работает перетаскивание
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const box = viewer.hero.screenBox(viewer.camera);
      if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y) {
        return;
      }
      // Колесо над героем крутит модель, а не прокручивает страницу
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? -event.deltaX : event.deltaY;
      attachPivot(viewer);
      // Направление: прокрутка вниз (deltaY > 0) крутит модель в сторону зрителя,
      // как в игре. Знак тот же, что у turn.target в библиотеке (там -d * WHEEL_TURN).
      const dir = delta > 0 ? -1 : 1;
      const s = spin();
      s.dir = dir;
      // Сколько секунд крутиться: прокрутка добавляет время вращения. Скорость
      // при этом не меняется — она всегда WHEEL_SPIN_SPEED, — меняется только
      // длительность. Время копится (несколько щелчков подряд = дольше крутится),
      // но не больше MAX_SPIN_TIME, чтобы при длинной прокрутке модель не крутилась
      // бесконечно.
      const add = Math.abs(delta) * unit * WHEEL_SPIN_TIME;
      s.left = Math.min(s.left + add, MAX_SPIN_TIME);
    };

    const attachWheel = (viewer) => {
      const canvas = viewer.canvas;
      const s = spin();
      if (s.canvas === canvas) {
        return;
      }
      s.canvas?.removeEventListener('wheel', onWheel);
      s.canvas?.removeEventListener('pointerdown', stopSpin);
      s.canvas?.removeEventListener('pointercancel', stopSpin);
      s.canvas = canvas;
      canvas.addEventListener('wheel', onWheel, { passive: false });
      // Перетаскивание мышью гасит вращение колеса
      canvas.addEventListener('pointerdown', stopSpin);
      canvas.addEventListener('pointercancel', stopSpin);
    };

    const onLoadWithWheel = () => {
      const viewer = heroElement.viewer;
      if (viewer?.hero) {
        attachWheel(viewer);
        // Патчи кадра и выгрузки — один раз на экземпляр viewer
        patchFrame(viewer);
        patchUnload(viewer);
        // Пивот ставится сразу: при новой модели turntable — новый объект
        attachPivot(viewer);
      }
      onLoad();
    };

    heroElement.removeEventListener('load', onLoad);
    heroElement.addEventListener('load', onLoadWithWheel);
    if (heroElement.viewer?.hero) {
      onLoadWithWheel();
    }

    return () => {
      resizeObserver.disconnect();
      const s = spin();
      s.speed = 0;
      s.left = 0;
      s.dir = 0;
      s.canvas?.removeEventListener('wheel', onWheel);
      s.canvas?.removeEventListener('pointerdown', stopSpin);
      s.canvas?.removeEventListener('pointercancel', stopSpin);
      s.canvas = null;
      // Пивот снимаем: turntable возвращается в сцену, иначе модель исчезнет
      const viewer = viewerRef.current;
      if (viewer) {
        detachPivot(viewer);
      }
      heroElement.removeEventListener('load', onLoadWithWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`hero3d${ready ? ' hero3d--ready' : ''}`} aria-hidden="true">
      <dota-hero
        ref={heroRef}
        hero={HERO_ID}
        controls="hero"
        wheel="false"
        bloom="false"
        assets={ASSETS_URL}
        style={{
          width: BOX_WIDTH,
          aspectRatio: '16 / 10'
        }}
      />
    </div>
  );
}
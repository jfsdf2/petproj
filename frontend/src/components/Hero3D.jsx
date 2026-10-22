// 3D-герой Dota 2 на фоне страницы через библиотеку dota-loadout (<dota-hero>).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import 'dota-loadout/element';
import './Hero3D.css';

// id героя из каталога ассетов (assets/heroes/<id>/hero.json)
const HERO_ID = 'broodmother';

// Откуда грузятся модели: "/" — свои файлы из frontend/public/heroes/
const ASSETS_URL = '/';

// Чувствительность вращения мышью (радианы на пиксель)
const DRAG_SENSITIVITY = 0.008;

// Запас рамки поверх бокса модели (съедает покачивание idle-анимации)
const FRAME_MARGIN = 1.2;

// Фиксированный размер модели на экране в пикселях по ограничивающей оси:
// модель не растёт/не сжимается при изменении окна (800/1.2 ≈ 667 px)
const MODEL_PIXELS = 800;

// Полярный угол камеры: смотрим на модель сверху (в градусах)
const CAMERA_ELEVATION = 13 * Math.PI / 180;

// Ширина окна героя: 50% экрана, не уже 760 и не шире 1280 px
const BOX_WIDTH = 'clamp(50vw, 760px, 1280px)';

export default function Hero3D() {
  const [ready, setReady] = useState(false);
  const wrapRef = useRef(null);
  const heroRef = useRef(null);
  const viewerRef = useRef(null);

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

      const width = viewer.canvas.clientWidth;
      const height = viewer.canvas.clientHeight;
      if (width && height) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(15));
        const tanH = tanV * (width / height);
        const depth = Math.max(viewSize.x, viewSize.z) / 2;
        const distance =
          Math.max(0.62 * viewSize.y / tanV, 0.68 * Math.max(viewSize.x, viewSize.z) / tanH) +
          depth;
        const fracW = viewSize.x / (2 * tanH * distance);
        const fracH = viewSize.y / (2 * tanV * distance);
        // Ось, что ограничивает кадр, и её текущий размер в пикселях
        const frac = Math.max(fracW, fracH);
        const axisPixels = frac === fracW ? width : height;
        viewer.zoom(Math.min(3, MODEL_PIXELS / (frac * axisPixels)));
      }
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

    // Вращение мышью: свои обработчики, чтобы не зависеть от внутренностей библиотеки
    const drag = { active: false, x: 0 };
    const onDown = (event) => {
      const viewer = viewerRef.current;
      if (!viewer || event.button !== 0) {
        return;
      }
      drag.active = true;
      drag.x = event.clientX;
      wrap.setPointerCapture?.(event.pointerId);
      wrap.style.cursor = 'grabbing';
    };
    const onMove = (event) => {
      if (!drag.active) {
        return;
      }
      const viewer = viewerRef.current;
      const dx = event.clientX - drag.x;
      drag.x = event.clientX;
      if (viewer) {
        viewer.rotate(dx * DRAG_SENSITIVITY, { relative: true });
      }
    };
    const onUp = () => {
      drag.active = false;
      wrap.style.cursor = 'grab';
    };

    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);

    return () => {
      heroElement.removeEventListener('load', onLoad);
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      wrap.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`hero3d${ready ? ' hero3d--ready' : ''}`} aria-hidden="true">
      <dota-hero
        ref={heroRef}
        hero={HERO_ID}
        controls="false"
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
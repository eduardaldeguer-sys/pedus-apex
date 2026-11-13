# Carpeta `models/` — tus 5 modelos 3D (`.glb` o `.obj`)

Sube aquí tus 5 modelos 3D con estos nombres base (extensión `.glb` o `.obj`,
el juego prueba ambas automáticamente):

1. `player-car.glb` / `player-car.obj` — tu coche (jugador)
2. `rival-car.glb` / `rival-car.obj` — coche de los rivales IA
3. `tree.glb` / `tree.obj` — árbol decorativo
4. `grandstand.glb` / `grandstand.obj` — grada / tribuna
5. `mountain.glb` / `mountain.obj` — montaña lejana

## Requisitos rápidos

- **`.glb` binario (recomendado):** texturas incrustadas, sin Draco.
- **`.obj` (también funciona):** sube también el **`.mtl`** del mismo nombre
  (`player-car.mtl`) y sus texturas, o el modelo se verá en gris.
- Base del modelo en el suelo (`y = 0`), centrado en XZ.
- Coches: **delante hacia +Z**. Si va al revés, pon `GLB_CAR_YAW = Math.PI` en `game.js`.
- La escala se ajusta sola; ideal < 5 MB por modelo.

## Cómo se cargan

- Sirviendo el repo con `python3 -m http.server 8000` o con GitHub Pages:
  se cargan automáticamente desde esta carpeta.
- Con doble clic en `index.html` (`file://`) el navegador bloquea archivos
  locales: en ese caso usa una URL `https://raw.githubusercontent.com/...`
  en `GLB_MODELS` (inicio de `game.js`). Ver `README.md` raíz.

Si un modelo falta, el juego usa el procedural equivalente y sigue funcionando.

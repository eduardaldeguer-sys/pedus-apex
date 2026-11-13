# Pedus Apex — Carrera 3D Arcade (Three.js)

Juego de carreras 3D en el navegador: circuito cerrado, 3 rivales IA, derrapes,
clima dinámico (lluvia, tormenta, niebla, atardecer), sombras dinámicas,
texturas procedurales hiperrealistas y soporte de modelos **GLB propios**.

## Cómo jugar

- **Vista previa de esta sesión:** pulsa **▶ JUGAR**.
- **Sin servidor:** abre `index.html` con doble clic (necesitas internet para el
  CDN de Three.js). Los modelos GLB locales necesitan un servidor HTTP para
  cargarse (ver abajo); sin ellos el juego usa los modelos procedurales.
- **Con servidor (recomendado para GLB):**
  ```bash
  python3 -m http.server 8000
  # abre http://localhost:8000
  ```

### Controles

| Tecla | Acción |
|---|---|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frenar / marcha atrás |
| `A` `D` / `←` `→` | Girar |
| `Espacio` | Freno de mano (derrape) |
| `R` | Reaparecer en pista |
| `C` | Cambiar cámara (3ª / 1ª persona) |
| `T` | Cambiar clima manualmente |
| `P` | Pausa |
| `M` | Silenciar |

El clima cambia solo cada ~55 segundos. Con lluvia/tormenta el asfalto se moja:
menos adherencia, más derrape, charcos, faros encendidos y rayos con truenos.

---

## Tus 5 modelos 3D (`.glb` o `.obj`)

Coloca tus archivos en la carpeta **`models/`** con estos nombres base
(también puedes cambiar las rutas en `GLB_MODELS` al inicio de `game.js`).
Se aceptan **ambos formatos**: el cargador prueba `.glb` y `.obj`
automáticamente, así que puedes subir el que tengas sin tocar código:

| # | Archivo (`.glb` o `.obj`) | Qué es | Uso en el juego |
|---|---|---|---|
| 1 | `models/player-car.*` | Tu coche (jugador) | Sustituye al coche rojo procedural |
| 2 | `models/rival-car.*` | Coche rival | Se clona en los 3 coches IA |
| 3 | `models/tree.*` | Árbol | Se instancia en los ~260 árboles del circuito |
| 4 | `models/grandstand.*` | Grada / tribuna | Se coloca en las 2 gradas junto a la meta |
| 5 | `models/mountain.*` | Montaña | Se coloca en el anillo de montañas lejanas |

Si un archivo falta o no se puede cargar, el juego **nunca se rompe**: usa el
modelo procedural de ese elemento. En el menú verás el estado (`5/5`, `3/5`…).

### Formato recomendado para cada modelo

- **`.glb` binario (recomendado):** un solo archivo con texturas incrustadas
  (materiales PBR estándar). Es el formato con mejor aspecto.
- **`.obj` (también funciona):** sube el `.obj` **y su `.mtl`** con el mismo
  nombre (`player-car.mtl`) más las texturas que referencie el `.mtl`, en la
  misma carpeta. Sin `.mtl`, el modelo se ve en gris neutro (solo geometría).
  El `.obj` no lleva rugosidad/metalicidad PBR, así que se ve más plano que el `.glb`.
- **Tamaño:** ideal < 5 MB por modelo (se sube bien a GitHub y carga rápido).
- **Sin compresión Draco** en `.glb` (el cargador no incluye el decodificador Draco).
- **Origen:** en el suelo (la base del modelo en `y = 0`), centrado en XZ.
- **Escala:** no te preocupes — el juego normaliza automáticamente la escala
  (coches a ~3,7 unidades de largo, gradas a ~18 de ancho, etc.).

#### Coches (1 y 2)

- **Delante = eje +Z** (la parte delantera del coche apunta hacia +Z).
  En Blender: si tu coche mira hacia −Z, gira el objeto 180° en Y antes de exportar.
  Si al probarlo va de culo, pon `GLB_CAR_YAW = Math.PI` en `game.js`.
- Las ruedas del GLB no giran (el juego no puede saber cuáles son); la carrocería
  sí se inclina en las curvas igual que el procedural.

#### Árbol (3) y montaña (5)

- Un solo objeto por modelo. La altura se usa para escalarlo en el escenario.
- Árbol: base en el suelo. Montaña: base en el suelo (se hunde 4 unidades).

#### Grada (4)

- Un solo objeto (grada completa con tejado si quieres). Se escala a ~18 unidades
  de ancho y se orienta hacia la pista automáticamente.

### Subirlo a GitHub y usarlo

1. Crea los 5 `.glb` (Blender, Maya, Substance, etc.) y expórtalos en binario.
2. Súbelos a este repositorio en la carpeta `models/` (p. ej. con la web de
   GitHub: *Add file → Upload files*, o con `git add models/ && git commit`).
3. **Opción A (misma carpeta):** no hay que tocar código. Sirve el repo con
   `python3 -m http.server 8000` o publícalo con **GitHub Pages** y los modelos
   se cargarán desde `models/`.
4. **Opción B (URL de GitHub):** cambia en `game.js` la ruta por la URL *raw*:
   ```js
   playerCar: 'https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/models/player-car.glb',
   ```
   Así funciona incluso abriendo `index.html` con doble clic (sin servidor),
   porque el `.glb` se descarga por HTTPS. (El juego en sí sigue necesitando
   internet para el CDN de Three.js.)

> ⚠️ Nota: abrir `index.html` con `file://` bloquea la carga de archivos
> locales por seguridad del navegador. Por eso, para la **Opción A** usa un
> servidor local o GitHub Pages; para doble clic directo usa la **Opción B**.

---

## Gráficos (v2)

- **Sombras:** sol direccional con sombras PCFSoft cuya cámara **sigue al coche**,
  así las sombras son nítidas cerca de la acción; `normalBias` anti-acné.
- **Texturas hiperrealistas procedurales:** asfalto con mapa de color, rugosidad
  y *bump* (grano de árido, grietas, huellas de neumáticos), hierba detallada,
  pintura de coche con *clearcoat* y reflejos de entorno (PMREM).
- **Postprocesado:** Bloom sutil (faros, sol y luces traseras brillan),
  *tone mapping* ACES y espacio de color sRGB.
- **Clima:** despejado, atardecer, lluvia, niebla y tormenta con transiciones
  suaves, lluvia de partículas, nubes a la deriva, charcos, asfalto mojado
  (rugosidad/reflejo según clima), faros automáticos y rayos con truenos.
- **Rendimiento:** geometrías/materiales reutilizados, `InstancedMesh` para
  árboles y rocas, `pixelRatio` limitado a 2, física con *delta time*.

## Archivos

| Archivo | Descripción |
|---|---|
| `index.html` | HUD, menús y carga de Three.js (CDN) |
| `style.css` | Estilo racing, HUD responsive |
| `game.js` | Motor del juego (clases: Game, Track, Car, AIController, WeatherManager, HUD, InputManager, AudioManager) |
| `models/` | Tus 5 modelos GLB (opcional) |

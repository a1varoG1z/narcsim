# Narcosim 🌵

Un simulador de estrategia por turnos sobre la historia del narcotráfico en América Latina, inspirado en *Crusader Kings*. Juego de un solo jugador, 100% estático (HTML/CSS/JS sin build ni backend), pensado para jugarse desde el móvil vía GitHub Pages.

## Jugar

Una vez publicado con GitHub Pages, abre la URL del sitio (Settings → Pages → Deploy from branch → rama `main`, carpeta `/ (root)`). No requiere build ni instalación.

Para probarlo en local:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(Tiene que servirse por HTTP, no abrirse como `file://`, porque carga los datos de cada época vía `fetch`.)

Para comprobar el balance del juego sin abrir el navegador (dinero, ejército, heat y tasa de arresto/muerte a lo largo de decenas de partidas simuladas):

```bash
node scripts/simulate-balance.mjs
```

Para correr la suite de tests automatizados (motor de turnos, adyacencia/combate, sucesión, fugas, guerras, economía, eventos guionizados):

```bash
npm test
```

El juego también es instalable como PWA (Añadir a pantalla de inicio) gracias a `manifest.json` y `service-worker.js`, y sigue funcionando offline tras la primera carga.

## Cómo funciona

- **Sin backend ni cuentas de usuario.** Todo el estado de la partida se guarda en `localStorage` del navegador, con opción de exportar/importar la partida como archivo `.json` desde la pestaña **Editor**.
- **Épocas históricas** (`data/eras/*.json`): cada una define cárteles, territorios y personajes de una etapa real del narcotráfico (Guadalajara 1975-89, Medellín vs Cali, el reparto de rutas 1990-2006, la fragmentación 2006-2015, CJNG vs Sinaloa 2015-actualidad, y la guerra interna Chapitos vs. La Mayiza 2024-actualidad).
- Los **líderes y hechos históricos principales son reales** (fechas de nacimiento, roles, hitos documentados). Los **cargos secundarios del organigrama y buena parte de las cifras económicas/militares son ficticios**, generados para completar la mecánica de juego — se indica explícitamente en el campo `historical` y en las notas de cada personaje.
- El jugador elige una época, y luego **encarna a un narco existente** (cualquier miembro del organigrama de un cártel real) **o funda su propio cártel** en un territorio libre, con un personaje totalmente personalizable (nombre, atributos, foto).
- El juego avanza **por turnos** (representando ~6 meses cada uno): se toman decisiones económicas, militares, de corrupción y diplomáticas, los cárteles rivales se simulan con una IA sencilla, y cada turno se resuelven eventos aleatorios (muertes, enfermedades, accidentes, traiciones, matrimonios, nacimientos, operativos policiales).
- Cuanto más "heat" (nivel de búsqueda) acumule tu cártel, más probable será sufrir un operativo policial. Si te arrestan con cadena perpetua, o mueres, heredas el control de un familiar o allegado (sucesión estilo CK3). Si el arresto es temporal, puedes optar por que un heredero gobierne de forma simulada hasta tu liberación.

## Estructura del proyecto

```
index.html            punto de entrada
manifest.json         manifiesto PWA (instalable en el móvil)
service-worker.js     caché offline de la app y los datos de las épocas
css/styles.css        estilos (tema oscuro, mobile-first)
js/                   lógica del juego (ES modules, sin build)
  model.js              modelos de datos (personajes, cárteles, territorios, roles, stats)
  state.js              construcción y persistencia de la partida (múltiples slots)
  turnEngine.js         motor de turnos: acciones, IA rival, guerras, sucesión, fugas
  events.js             eventos aleatorios (mortalidad, familia, lealtad, policía)
  scriptedEvents.js     eventos históricos guionizados (algunos interactivos)
  npcGenerator.js       generación procedural de personajes secundarios
  ui/                   componentes compartidos (modal, tarjetas de personaje)
  screens/              pantallas (menú, elegir época, elegir/crear personaje, dashboard)
  screens/tabs/         pestañas del dashboard (resumen, decisiones, organigrama, mapa, diplomacia, medios, familia, estadísticas, editor)
data/eras/*.json      datos de cada época histórica
scripts/simulate-balance.mjs   simulador de balance sin interfaz
tests/*.test.js       suite de tests automatizados (node --test)
```

## Aviso

Juego de ficción histórica de un solo jugador, con fines narrativos y de entretenimiento. No pretende glorificar la violencia ni el crimen; reutiliza figuras históricas públicas de forma similar a series, películas y otros videojuegos ambientados en esta temática. Revisa `TODO.md` para el estado y alcance del proyecto.

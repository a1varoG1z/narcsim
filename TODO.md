# TODO / Roadmap — Narcosim

Estado del proyecto tras la primera versión jugable (MVP). Marcado ✅ lo implementado, 🟡 lo implementado de forma básica/mejorable, ⬜ lo pendiente.

## Base del juego

- ✅ Sitio 100% estático (HTML/CSS/JS, sin build) listo para GitHub Pages.
- ✅ Guardado en `localStorage` + exportar/importar partida como `.json`.
- ✅ 5 épocas jugables con datos históricos reales + territorios + organigramas (`data/eras/*.json`).
- ✅ Selección de época → jugar como narco existente (cualquier cargo del organigrama) o crear uno nuevo en un territorio libre.
- ✅ Creación de personaje: nombre, sexo, edad, atributos, foto de perfil (subida de imagen, redimensionada y guardada en base64).
- ✅ Organigrama completo por cártel: líder, segundo al mando, jefe de sicarios, de ejército/paramilitar, de corrupción política, de corrupción policial, de narcotráfico/rutas, de producción, económico/lavado, de imagen pública, de inteligencia, de relaciones externas. Roles vacantes se rellenan con personajes generados y son reasignables desde la pestaña Organigrama.
- ✅ Recursos por cártel: dinero, ejército, corrupción en el gobierno, corrupción policial, imagen pública, heat (nivel de búsqueda).
- ✅ Motor de turnos (~6 meses/turno): acciones del jugador (producción, tráfico, sobornos, reclutamiento, imagen pública, bajo perfil), IA básica para cárteles rivales, resolución automática de guerras activas.
- ✅ Mapa de territorios clickable, coloreado por cártel controlador, con ataque directo a territorios rivales.
- ✅ Diplomacia: declarar guerra, proponer paz, proponer alianza, con aceptación/rechazo probabilístico.
- ✅ Eventos aleatorios: muerte natural/enfermedad/accidente (según edad y rol), operativos policiales (según heat vs. corrupción), traiciones/desvíos de fondos y, en casos extremos, golpes internos contra el líder.
- ✅ Matrimonios y nacimientos automáticos + acciones manuales de "buscar pareja" / "tener un hijo" en la pestaña Familia, con árbol genealógico básico (padres, cónyuge, hijos, hermanos).
- ✅ Sucesión estilo CK3: al morir o ser condenado a cadena perpetua el personaje del jugador, se elige heredero (hijo mayor → cónyuge → segundo al mando → otro cargo → cualquier miembro). Si el cártel se queda sin nadie, termina la partida.
- ✅ Arresto temporal: opción de que un heredero gobierne de forma simulada hasta la liberación, o esperar en prisión.
- ✅ Estadísticas: gráficas de evolución (dinero, ejército, heat, imagen, territorios) y tabla comparativa entre cárteles.
- ✅ Editor interno: edición libre de cualquier cártel (recursos) y personaje (nombre, año de nacimiento, vivo/muerto, cargo, atributos), export de partida, reinicio de partida.
- ✅ Diseño mobile-first probado en viewport de móvil (390px) sin errores de consola.

## Balance y realismo (segunda pasada)

- ✅ **Adyacencia real entre territorios**: cada territorio tiene una lista `adj` de vecinos (aproximada a la geografía real); solo se puede atacar un territorio que linde con uno de los tuyos. La IA respeta la misma regla, así que las guerras solo avanzan si hay frontera compartida.
- ✅ **Combate ponderado por calidad de mando**: el resultado de una batalla ya no depende solo del tamaño del ejército — la Violencia/Astucia de tu jefe de sicarios y de ejército, y el Liderazgo de tu líder, mueven la balanza hasta un ±30%.
- ✅ **Deserción por impago**: si un cártel no puede cubrir la nómina de su ejército con sus ingresos, una parte de sus hombres deserta en vez de quedarse gratis para siempre. Esto hace que los cárteles sobredimensionados para su territorio (ej. Tijuana a finales de los 90, Santa Rosa de Lima) decaigan de forma orgánica hacia un tamaño sostenible, reflejando su trayectoria histórica real.
- ✅ **Eventos históricos guionizados** (`js/scriptedEvents.js`): fechas reales que impactan la partida una sola vez — el asesinato de Kiki Camarena (1985) dispara una ofensiva binacional contra Guadalajara; la guerra de Escobar contra la extradición (1989) y el "Proceso 8.000" contra Cali (1995); las muertes de Amado Carrillo Fuentes (1997), Arturo Beltrán Leyva (2009), Nazario Moreno (2010) y Heriberto Lazcano (2012); y la guerra interna Chapitos vs. La Mayiza en Sinaloa (2024). Si estás jugando exactamente como el personaje afectado, el desenlace es un riesgo del 55% (puedes desafiar tu destino histórico) en vez de una certeza — para los NPC, ocurre tal cual pasó en la realidad.
- ✅ **Simulador de balance sin interfaz** (`scripts/simulate-balance.mjs`): ejecuta decenas de partidas automáticas por época/cártel para comprobar que el dinero, el ejército, el heat y la tasa de arresto/muerte se mantienen en rangos razonables. Útil para futuros ajustes — ejecútalo con `node scripts/simulate-balance.mjs`.

## Tercera pasada: fugas, expansión, vínculos y partidas múltiples

- ✅ **Ocupar territorios neutrales**: ya no hace falta esperar a fundar un cártel para expandirte a una zona libre — cualquier cártel (jugador o IA) puede intentar ocupar un territorio sin dueño que linde con el suyo, con un coste y una probabilidad de éxito.
- ✅ **Fuga de prisión jugable**: si tu condena es temporal (no cadena perpetua), puedes intentar fugarte en vez de esperar — la probabilidad depende de tu Sigilo/Astucia y de la corrupción policial de tu cártel; si fracasa, la condena se alarga.
- ✅ **La fuga de El Chapo de Puente Grande (2001)**: si sigue preso para entonces, escapa tal cual ocurrió en la realidad (o con un 80% de probabilidad si eres tú quien lo interpreta).
- ✅ **Se corrigió un vacío real**: los personajes de cárteles IA con condena temporal nunca se liberaban (solo se comprobaba la excarcelación del propio jugador). Ahora cualquier personaje sale al cumplir su condena, y si era el líder interino de un cártel, recupera el mando.
- ✅ **Vínculos personales con tu gente**: cada miembro del cártel tiene un "vínculo contigo" (0-100) que fluctúa con la marcha del cártel (dinero, heat) y que puedes fortalecer activamente desde la pestaña Familia ("Pasar tiempo"). Un vínculo fuerte reduce el riesgo de traición calculado a partir de tus atributos; uno débil lo agrava.
- ✅ **Partidas múltiples**: puedes tener varias partidas guardadas a la vez (una por combinación de época/cártel/personaje que empieces), elegir cuál continuar o borrar desde el menú principal, en vez de un único hueco de guardado.

## Pendiente / mejoras futuras

### Mapa
- ⬜ Mapa geográficamente preciso (actualmente es una disposición esquemática de territorios con adyacencia aproximada, no coordenadas reales).

### Guerras y combate
- 🟡 Resolución de batallas por turno con ponderación de mando y adyacencia. Pendiente: tácticas, terreno, refuerzos, moral, guerras prolongadas con objetivos concretos (no solo conquista de una plaza).
- ⬜ Historial/relato detallado de cada guerra (bajas totales, duración, tratados).

### Familia, romances e intriga
- 🟡 Romance, genealogía y vínculos básicos ya implementados. Pendiente: cortejo con decisiones narrativas, infidelidades, divorcios, rivalidades entre hermanos, tramas de honor/venganza.
- 🟡 Eventos narrativos únicos para figuras históricas reales: ya cubiertos varios hitos clave (ver arriba). Pendiente: más eventos (el Proceso 8.000 con más detalle, capturas de los Arellano Félix, el ascenso del CJNG, etc.) y que algunos ofrezcan una decisión interactiva con varias opciones en vez de un riesgo automático binario.

### Policía / persecución
- 🟡 El heat sube/baja, los operativos policiales escalan con la notoriedad y ya se puede intentar una fuga. Pendiente: mecánica de persecución más visible (barra de "expediente", informantes, redadas planeadas vs. sorpresa), fuga posible incluso desde cadena perpetua (como la extradición/traslados en la vida real).

### Imagen pública y medios
- 🟡 Imagen pública como estadística simple. Pendiente: sección de medios dedicada (prensa, corridos, narcocultura, reputación internacional) con decisiones propias.

### Logística y economía
- 🟡 Producción/tráfico simplificados a dos acciones genéricas. Pendiente: elegir dónde producir, con quién asociarse para vender, rutas específicas, mercados internacionales, lavado de dinero como sistema propio.

### Personajes y datos
- ⬜ Ampliar el roster de personajes secundarios reales cuando el usuario aporte información adicional (ver nota abajo).
- ⬜ Más eras/variantes (ej. subdividir 2015-actualidad en la guerra interna de Sinaloa como época jugable propia).
- ⬜ Editor visual de nuevas épocas/escenarios desde la propia interfaz (hoy los `.json` de época se editan a mano).

### Técnico / calidad de vida
- ⬜ Tests automatizados tipo "unit test" (hoy hay verificación manual con Playwright + el simulador de balance, pero no una suite formal con asserts).
- ⬜ Accesibilidad (lectores de pantalla, contraste AA completo).
- ⬜ PWA / instalable en pantalla de inicio del móvil.

## Nota sobre los datos históricos

Los cárteles, líderes y hitos principales de cada época están basados en hechos públicamente documentados (fechas, nombres, roles conocidos). Donde no existe información pública fiable —la mayoría de los cargos secundarios del organigrama, cifras exactas de dinero/ejército, y varios personajes familiares— se han generado datos ficticios verosímiles, marcados con `"historical": false` en los `.json`. Si quieres corregir o ampliar algún dato con información real que aportes tú, dímelo y lo actualizo.

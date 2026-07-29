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

## Cuarta pasada: medios, economía profunda, romance interactivo, calidad técnica

- ✅ **Historial de guerras**: cada guerra queda registrada (inicio, fin, bajas de cada bando, territorios que cambiaron de manos) y es visible en la pestaña Diplomacia, tanto en curso como terminadas.
- ✅ **Pestaña "Medios" dedicada**: cinco acciones propias de imagen pública (comunicado de prensa, corridos/narcocultura, obra social, entrevista internacional de alto riesgo, control de daños), más una nueva estadística de "reputación internacional" distinta de la imagen pública local. Sustituye a la antigua acción genérica de "campaña de imagen".
- ✅ **Socios de tráfico**: al enviar un cargamento puedes elegir vender en el mercado abierto o a un cártel concreto — los aliados pagan mejor, no puedes venderle a quien está en guerra contigo, y la venta afecta ligeramente la tensión entre ambos.
- ✅ **Lavado de dinero**: convierte dinero caliente en limpio a través de negocios legales, con una comisión que depende de tu jefe económico y una reducción de heat proporcional a la cantidad lavada.
- ✅ **Cortejo interactivo**: "Buscar pareja" ahora presenta 3 candidatos con un pequeño perfil; la aceptación depende de tu Carisma, en vez de una boda instantánea garantizada.
- ✅ **Crisis matrimonial e infidelidad**: tu relación de pareja tiene un "vínculo" que fluctúa turno a turno; una crisis de infidelidad te ofrece perdonar, ignorar o divorciarte, cada una con consecuencias distintas. También puedes pedir el divorcio libremente en cualquier momento.
- ✅ **Evento interactivo de Camarena (1985)**: si juegas como el Cártel de Guadalajara, el asesinato de Kiki Camarena ahora te deja elegir cómo responder (entregar un chivo expiatorio, negarlo todo, o desafiar a la DEA), cada opción con un desenlace distinto — en vez de un efecto automático fijo. El marco es reutilizable para futuros eventos interactivos.
- ✅ **PWA instalable**: `manifest.json` + service worker con caché de la app y los datos de las épocas, para poder añadir Narcosim a la pantalla de inicio del móvil y jugar offline tras la primera carga.
- ✅ **Pasada de accesibilidad**: enlace para saltar al contenido, foco visible en todos los elementos interactivos, `aria-label`/`role`/`tabindex` en los controles que lo necesitaban, gestión de foco y cierre con Escape en los modales, asociación explícita `label`/`for` en el formulario de creación de personaje.
- ✅ **Suite de tests automatizados** (`tests/*.test.js`, `node --test` / `npm test`): 17 pruebas cubriendo construcción de partida, adyacencia y ataques, sucesión y herencia, fugas, guerras, lavado de dinero y el evento interactivo de Camarena — para detectar regresiones sin depender solo de pruebas manuales con Playwright.

## Pendiente / mejoras futuras

### Mapa
- ⬜ Mapa geográficamente preciso (actualmente es una disposición esquemática de territorios con adyacencia aproximada, no coordenadas reales).

### Guerras y combate
- 🟡 Resolución de batallas por turno con ponderación de mando, adyacencia e historial. Pendiente: tácticas, terreno, refuerzos, moral, guerras prolongadas con objetivos concretos (no solo conquista de una plaza), tratados de paz con condiciones (cesión de territorio, indemnización).

### Familia, romances e intriga
- 🟡 Cortejo, crisis matrimonial, genealogía y vínculos ya implementados. Pendiente: rivalidades entre hermanos, tramas de honor/venganza, amistades explícitas (hoy el vínculo cubre solo la relación jugador↔miembro, no las relaciones entre miembros del cártel entre sí).
- 🟡 Eventos narrativos únicos: ya cubiertos varios hitos clave y el primer evento interactivo (Camarena). Pendiente: convertir más eventos en decisiones interactivas (Proceso 8.000, capturas de los Arellano Félix, el ascenso del CJNG, etc.).

### Policía / persecución
- 🟡 El heat sube/baja, los operativos policiales escalan con la notoriedad y ya se puede intentar una fuga. Pendiente: mecánica de persecución más visible (barra de "expediente", informantes, redadas planeadas vs. sorpresa), fuga posible incluso desde cadena perpetua (como la extradición/traslados en la vida real).

### Imagen pública y medios
- 🟡 Sección de medios ya implementada con 5 acciones propias y reputación internacional. Pendiente: que la reputación internacional tenga efectos mecánicos propios más allá de lo cosmético (p. ej. atraer atención de agencias internacionales, abrir mercados).

### Logística y economía
- 🟡 Socios de tráfico y lavado de dinero ya implementados. Pendiente: elegir dónde producir específicamente (no solo una acción genérica de "invertir"), rutas concretas en el mapa, mercados internacionales diferenciados.

### Personajes y datos
- ⬜ Ampliar el roster de personajes secundarios reales cuando el usuario aporte información adicional (ver nota abajo).
- ⬜ Más eras/variantes (ej. subdividir 2015-actualidad en la guerra interna de Sinaloa como época jugable propia).
- ⬜ Editor visual de nuevas épocas/escenarios desde la propia interfaz (hoy los `.json` de época se editan a mano).

### Técnico / calidad de vida
- ✅ Tests automatizados y PWA ya implementados (ver arriba).
- 🟡 Accesibilidad: pasada inicial hecha (foco, aria-labels, contraste, cierre con Escape). Pendiente: pruebas reales con lector de pantalla, revisión completa de contraste AA en todos los estados de color.

## Nota sobre los datos históricos

Los cárteles, líderes y hitos principales de cada época están basados en hechos públicamente documentados (fechas, nombres, roles conocidos). Donde no existe información pública fiable —la mayoría de los cargos secundarios del organigrama, cifras exactas de dinero/ejército, y varios personajes familiares— se han generado datos ficticios verosímiles, marcados con `"historical": false` en los `.json`. Si quieres corregir o ampliar algún dato con información real que aportes tú, dímelo y lo actualizo.

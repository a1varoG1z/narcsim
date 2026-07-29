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

## Pendiente / mejoras futuras

### Mapa
- ⬜ Mapa geográficamente preciso (actualmente es una disposición esquemática de territorios, no coordenadas reales).
- ⬜ Adyacencia real entre territorios (hoy se puede atacar cualquier territorio rival, no solo los colindantes).
- ⬜ Ocupar territorios neutrales/sin dueño (hoy solo se pueden fundar cárteles nuevos ahí al iniciar partida).

### Guerras y combate
- 🟡 Resolución de batallas simplificada (comparación de ejército + azar). Pendiente: tácticas, terreno, refuerzos, moral, guerras prolongadas con objetivos.
- ⬜ Historial/relato detallado de cada guerra (bajas totales, duración, tratados).

### Familia, romances e intriga
- 🟡 Romance y genealogía básicos. Pendiente: cortejo con decisiones narrativas, infidelidades, divorcios, rivalidades entre hermanos, tramas de honor/venganza.
- ⬜ Sistema de amistades/confianza explícito entre miembros del cártel (hoy solo hay "lealtad" derivada de atributos).
- ⬜ Eventos narrativos únicos (no solo aleatorios genéricos) para figuras históricas reales (ej. la fuga de El Chapo, la guerra Chapitos vs. Mayiza en 2024).

### Policía / persecución
- 🟡 El heat sube/baja y los operativos policiales ya escalan con la notoriedad. Pendiente: mecánica de persecución más visible (barra de "expediente", informantes, redadas planeadas vs. sorpresa), fugas de prisión jugables.

### Imagen pública y medios
- 🟡 Imagen pública como estadística simple. Pendiente: sección de medios dedicada (prensa, corridos, narcocultura, reputación internacional) con decisiones propias.

### Logística y economía
- 🟡 Producción/tráfico simplificados a dos acciones genéricas. Pendiente: elegir dónde producir, con quién asociarse para vender, rutas específicas, mercados internacionales, lavado de dinero como sistema propio.

### Personajes y datos
- ⬜ Ampliar el roster de personajes secundarios reales cuando el usuario aporte información adicional (ver nota abajo).
- ⬜ Más eras/variantes (ej. subdividir 2015-actualidad en la guerra interna de Sinaloa como época jugable propia).
- ⬜ Editor visual de nuevas épocas/escenarios desde la propia interfaz (hoy los `.json` de época se editan a mano).

### Técnico / calidad de vida
- ⬜ Múltiples slots de partida guardada (hoy solo hay un slot en `localStorage`).
- ⬜ Tests automatizados (hoy solo se ha verificado manualmente con Playwright).
- ⬜ Accesibilidad (lectores de pantalla, contraste AA completo).
- ⬜ PWA / instalable en pantalla de inicio del móvil.

## Nota sobre los datos históricos

Los cárteles, líderes y hitos principales de cada época están basados en hechos públicamente documentados (fechas, nombres, roles conocidos). Donde no existe información pública fiable —la mayoría de los cargos secundarios del organigrama, cifras exactas de dinero/ejército, y varios personajes familiares— se han generado datos ficticios verosímiles, marcados con `"historical": false` en los `.json`. Si quieres corregir o ampliar algún dato con información real que aportes tú, dímelo y lo actualizo.

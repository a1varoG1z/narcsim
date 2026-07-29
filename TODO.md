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
- ✅ **Suite de tests automatizados** (`tests/*.test.js`, `node --test` / `npm test`): pruebas cubriendo construcción de partida, adyacencia y ataques, sucesión y herencia, fugas, guerras, lavado de dinero y los eventos interactivos — para detectar regresiones sin depender solo de pruebas manuales con Playwright.

## Quinta pasada: producción por territorio, segundo evento interactivo, reputación con efecto real

- ✅ **Producción por territorio**: "Invertir en producción" ya no es una acción genérica del cártel — eliges en cuál de tus territorios invertir, y el rendimiento escala con el valor económico de ese territorio concreto.
- ✅ **Segundo evento histórico interactivo**: el "Proceso 8.000" (1995) contra el Cártel de Cali ahora también es una decisión con tres opciones (entrega pactada, resistir sobornando jueces, o escalar la violencia) cuando juegas como Cali, siguiendo el mismo patrón que el evento de Camarena.
- ✅ **La reputación internacional ya tiene efecto mecánico**: abre un bonus de exportación de hasta +25% sobre el ingreso por territorio con fama máxima, en vez de ser puramente cosmética.

## Sexta pasada: tratados de paz, persecución más visible, sexta época jugable

- ✅ **Tratados de paz con condiciones**: al proponer la paz puedes ofrecer ceder uno de tus territorios (sube mucho la probabilidad de aceptación) o exigir una indemnización del 20% del dinero del rival (si le superas claramente en ejército). Los términos quedan registrados en el historial de guerras.
- ✅ **Persecución más visible**: el heat ahora muestra una etiqueta descriptiva (Bajo perfil / En el radar / Buscado / Objetivo prioritario / Cacería nacional) y un porcentaje real de "riesgo de operativo este turno", visible en Resumen y en Medios.
- ✅ **Sexta época jugable: "Los Chapitos contra La Mayiza" (2024-actualidad)**: cubre la guerra civil real dentro del Cártel de Sinaloa desde julio de 2024, cuando Joaquín Guzmán López entregó a El Mayo Zambada a EE.UU. Juegas desde el minuto uno como una de las dos facciones (o fundas tu propio grupo), con El Chapo y El Mayo como patriarcas presos y el CJNG acechando desde fuera. Esto también cubre lo que antes era un evento pendiente de "más eras/variantes".

## Séptima pasada: límite de acciones, economía visible, más rivales, sucesión y editor a fondo

- ✅ **Límite de acciones por turno**: ya no puedes encadenar decisiones económicas/de imagen infinitas en un mismo turno — tienes 3 acciones "de gestión" (producción, tráfico, sobornos, reclutamiento, medios, lavado...) antes de tener que avanzar el turno. Las jugadas de guerra/diplomacia (declarar guerra, atacar, ocupar, proponer paz/alianza) no consumen del cupo, ya que llevan su propio peso estratégico.
- ✅ **Pestaña "Economía" dedicada**: desglose claro de ingreso por territorio, bonus de exportación, mantenimiento del ejército y balance neto por turno, más el total histórico de dinero lavado — antes esta información solo se podía deducir viendo subir o bajar el dinero.
- ✅ **Tercer rival en dos épocas**: "El Cártel de Guadalajara" añade la plaza real de Ojinaga liderada por Pablo Acosta Villarreal ("El Zorro de Ojinaga"); "Medellín vs Cali" añade la organización real del Norte del Valle liderada por Iván Urdinola Grajales ("El Enano"), separada de Cali como territorio y cártel propios. Ambas partidas dejan de ser un enfrentamiento de solo dos bandos.
- ✅ **Designar heredero**: desde la pestaña Familia puedes elegir de antemano quién heredará el cártel (hijos, cónyuge o cualquier jefe de tu organigrama), en vez de depender siempre de la elección automática al morir. Si tu elegido sigue vivo y disponible en el momento de la sucesión, hereda directamente sin pasar por el diálogo de sucesión.
- ✅ **Instruir a tu heredero**: una vez designado, puedes pasar tiempo con él o ella para reforzar vuestro vínculo y mejorar uno de sus atributos, una vez por turno.
- ✅ **Matrimonios de alianza**: puedes casar a un familiar soltero en edad de merecer con alguien de otro cártel para rebajar la tensión entre ambas organizaciones, además del cortejo personal del propio jugador.
- ✅ **Ver cualquier cártel rival**: nueva vista de perfil de cártel (recursos, organigrama completo, territorios) accesible haciendo clic en cualquier cártel desde el Mapa, Estadísticas o Diplomacia — antes solo podías ver el detalle de tu propio cártel.
- ✅ **Editor interno mucho más completo**: además de cártel y personaje, ahora puedes editar el valor económico y el controlador de cualquier territorio, el estado y la tensión de las relaciones entre cárteles, y los vínculos familiares de un personaje (pareja, padres, añadir/quitar hijos) con subida de foto también disponible fuera de la creación de personaje.

## Octava pasada: familia como diálogo interactivo (en marcha)

- ✅ **"Formar una familia" ya no es un solo clic**: al intentarlo se abre una conversación real por pasos — cada respuesta que eliges lleva a la siguiente réplica, encadenando opciones concretas (no saltos al azar) y subiendo de tono progresivamente hasta un "fundido a negro" final, sin contenido explícito. El "calor" acumulado según tus elecciones (y tu Carisma) decide las probabilidades de éxito, en vez de una moneda al aire fija.
- ✅ **El embarazo tarda de verdad**: si el intento sale bien, la mujer queda embarazada y el nacimiento no ocurre hasta que pasan ~9 meses de tiempo de partida (ajustado a la duración de turno de cada época), visible en una tarjeta de "Embarazos en curso" en la pestaña Familia — antes el hijo aparecía en el acto.
- ✅ **No solo con tu cónyuge**: puedes intentarlo con tu pareja o buscar a alguien nuevo (como en el cortejo), que pasa a formar parte de la partida sea cual sea el resultado de esa noche.
- ✅ **Diálogo editable desde el Editor**: el árbol de la conversación se guarda en la propia partida como JSON editable (textos, opciones, a qué nodo lleva cada una), con validación básica y un botón para restaurar la versión por defecto — así puedes escribir tus propias variantes sin tocar código.

## Pendiente / mejoras futuras

### Mapa
- ⬜ Mapa geográficamente preciso (actualmente es una disposición esquemática de territorios con adyacencia aproximada, no coordenadas reales).
- ⬜ **Cubrir todo el mapa latinoamericano relevante por época con muchos más cárteles** (hoy hay 2-4 bandos por partida, que se siente poco competitivo), incluyendo narcotráfico ocurriendo en varios países a la vez (p. ej. en la época de Escobar debería existir tráfico en más sitios además de Medellín/Cali); alternativa/complemento: que aparezcan cárteles nuevos generados aleatoriamente en territorios libres a medida que avanza la partida, no solo al fundar el del jugador.
- ⬜ **La expansión no debería acabarse al conquistar los territorios de tu región de origen**: el mapa jugable tiene que extenderse por toda Latinoamérica (adaptado a los cárteles de cada época) para que un cártel dominante (p. ej. Medellín) pueda seguir expandiéndose a otros países (p. ej. hacia México), no solo dentro del suyo.

### Guerras y combate
- 🟡 Resolución de batallas por turno con ponderación de mando, adyacencia, historial y tratados con condiciones (ver arriba). Pendiente: tácticas, terreno, refuerzos, moral, guerras prolongadas con objetivos concretos más allá de la conquista de una plaza.
- 🟡 **Bajas reales de sicarios/ejército en combate** (hoy una guerra mueve territorio pero no reduce tropas de forma visible y trazable) y **decisiones concretas de guerra** en vez de un único botón genérico de "atacar". Ya existe "Ordenar un atentado" contra una persona concreta de un cártel rival (ver más abajo); falta sabotaje, redadas específicas y que las bajas de combate queden registradas con el mismo detalle que las guerras.
- ⬜ **Conquistar territorios vacíos y derrotar a otro cártel es demasiado fácil hoy**: falta dificultad y profundidad real (resistencia, coste, riesgo de fallo) en vez de ser casi automático con un solo clic.

### Motor de turnos y acciones
- ✅ **Cupo de acciones subido de 3 a 5 por turno**, y **tres acciones nuevas**: "Extorsionar un territorio" (dinero inmediato sin coste, a cambio de imagen y algo de heat — pensada para partidas rápidas de necesidad de caja), "Desarrollar un territorio" (inversión de crecimiento que sube el valor económico de un territorio de forma permanente, sin gastar del cupo de acciones, como ocupar/atacar) y "Ordenar un atentado" (elegir a una persona concreta de un cártel rival para asesinar, con éxito basado en tu jefe de sicarios frente al sigilo del objetivo; si tiene éxito o fracasa, entráis en guerra). La IA rival también usa las tres. Sigue habiendo hueco para más alternativas económicas (ver "Dimensión económica" más abajo).
- ⬜ **La simulación de un turno no debería resolverse siempre de un tirón**: si durante esos meses ocurre algo importante — incluida una acción rival que te afecta directamente — el turno debería pararse para que puedas reaccionar/decidir, en vez de solo aparecer ya resuelto en el registro.

### Familia, romances e intriga
- 🟡 Cortejo, crisis matrimonial, genealogía, vínculos y ahora un diálogo interactivo para formar una familia con embarazo real (ver arriba). Pendiente: rivalidades entre hermanos, tramas de honor/venganza, amistades explícitas (hoy el vínculo cubre solo la relación jugador↔miembro, no las relaciones entre miembros del cártel entre sí).
- 🟡 Eventos narrativos únicos: ya van dos hitos convertidos en decisiones interactivas (Camarena, Proceso 8.000). Pendiente: más eventos (capturas de los Arellano Félix, el ascenso del CJNG, etc.) con el mismo patrón interactivo.
- ⬜ **Extender el patrón de diálogo interactivo** (como el de formar una familia) a otras acciones del juego que hoy son un solo clic, y **conversaciones con personajes de otros cárteles** (negociación, intimidación, reclutamiento), no solo los botones de guerra/paz/alianza.

### Policía / persecución
- 🟡 El heat ya tiene etiquetas descriptivas y un indicador de riesgo real, y se puede intentar una fuga. Pendiente: informantes, redadas planeadas vs. sorpresa, fuga posible incluso desde cadena perpetua (como la extradición/traslados en la vida real).

### Imagen pública y medios
- ✅ Sección de medios con 5 acciones propias y reputación internacional con efecto mecánico real (ver arriba). Pendiente: efectos adicionales más específicos (atraer atención de agencias internacionales concretas, desbloquear aliados extranjeros).

### Logística y economía
- 🟡 Socios de tráfico, lavado de dinero y producción por territorio ya implementados. Pendiente: rutas concretas dibujadas en el mapa, mercados internacionales diferenciados por región (no solo un bonus agregado de reputación).
- ⬜ **Dimensión económica mucho más grande**: más categorías de inversión (propiedades, arte, negocios legales, armas, líneas de droga concretas), cada una con su propio riesgo/rentabilidad, en vez de las pocas acciones genéricas actuales.
- ✅ **Revisado el dinero/ejército inicial del Cártel de Medellín**: subido de 2200 a 3400 (dinero) y de 1400 a 1600 (ejército) para reflejar que, al inicio de esa época, Escobar ya era muy superior en poder de fuego y riqueza al todavía discreto Cártel de Cali — antes estaban casi empatados.
- ✅ **Reescalada toda la economía a cifras reales**: todo el dinero del juego (capital inicial, coste de cada acción, ingreso por territorio, nóminas, sobornos, indemnizaciones, lavado) se multiplicó de forma uniforme (`MONEY_SCALE = 10.000`, exportado desde `turnEngine.js`) para que los números se lean como dólares reales — Escobar arranca ahora con $34.000.000 en vez de $3.400 — sin alterar en nada el balance ya ajustado (todas las fórmulas se multiplicaron por igual, así que las proporciones y la duración de las partidas no cambian, solo la escala visible). De paso se eliminó la duplicación de costes entre `turnEngine.js` y las pestañas de Decisiones/Medios (ahora leen `ACTION_COSTS` en vez de repetir cada número a mano).

### Personajes y datos
- ⬜ Ampliar el roster de personajes secundarios reales cuando el usuario aporte información adicional (ver nota abajo).
- ⬜ **Adjuntar retrato por URL en el editor**, como alternativa a subir un archivo.
- ✅ Más eras/variantes: añadida la guerra interna de Sinaloa (Chapitos vs. Mayiza, 2024-actualidad) como época jugable propia (ver arriba).
- ⬜ Editor visual de nuevas épocas/escenarios desde la propia interfaz (hoy los `.json` de época se editan a mano).
- ⬜ **Sección de fallecidos**: una vista propia con los personajes muertos de la partida, ordenable por importancia/cargo/cártel/causa — hoy solo se ven de pasada en el registro de sucesos y en la ficha de cada uno.
- ⬜ **Retratos generados automáticamente** para personajes creados por el juego (no históricos, sin foto subida), en vez del icono genérico actual.
- ⬜ **Revisión completa de realismo de todos los `.json` de época**: una vez encajen la nueva escala económica, la expansión por todo el mapa y la mayor variedad de acciones (ver arriba), pasar por los 6 archivos de época a la vez para que todo (territorios, adyacencia, cárteles, recursos iniciales, personajes) sea coherente entre sí, en vez de ir tocando números sueltos.

### Técnico / calidad de vida
- ✅ Tests automatizados y PWA ya implementados (ver arriba).
- 🟡 Accesibilidad: pasada inicial hecha (foco, aria-labels, contraste, cierre con Escape). Pendiente: pruebas reales con lector de pantalla, revisión completa de contraste AA en todos los estados de color.
- ✅ **Editor de diálogos simplificado**: ya no hace falta escribir JSON — se elige un nodo de la conversación de una lista, se edita su texto y cada opción (texto, a qué nodo lleva o si termina la escena, "calor") con campos normales, se pueden añadir/eliminar nodos y marcar cuál es el inicial. El modo JSON se mantiene como alternativa avanzada, plegada, para pegar un árbol completo de una vez.
- ⬜ **Adjuntar retrato por URL** en el editor, además de subir archivo.
- ⬜ **Modo rápido/simulado** para cualquier interacción tipo diálogo (empezando por "Formar una familia"): poder resolverla al instante con un resultado razonable, para partidas más rápidas.
- ⬜ **Guardado en GitHub** de la partida (con todo lo editado/jugado) — necesita decidir cómo manejar credenciales de forma segura en un sitio estático sin backend. Además, **exportar/importar diálogos por separado** del resto de la partida, para reutilizar conversaciones ya escritas en otras partidas sin rehacerlas.

## Nota sobre los datos históricos

Los cárteles, líderes y hitos principales de cada época están basados en hechos públicamente documentados (fechas, nombres, roles conocidos). Donde no existe información pública fiable —la mayoría de los cargos secundarios del organigrama, cifras exactas de dinero/ejército, y varios personajes familiares— se han generado datos ficticios verosímiles, marcados con `"historical": false` en los `.json`. Si quieres corregir o ampliar algún dato con información real que aportes tú, dímelo y lo actualizo.

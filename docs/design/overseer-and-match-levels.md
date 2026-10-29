# Overseer y niveles dentro de la partida

Estado: diseño de la próxima iteración. No se activan ni el objetivo neutral ni los niveles con esta entrega.

## Objetivo neutral: The Overseer

El Overseer es un guardián mecánico neutral situado en un foso lateral conectado al carril central. Cualquiera de los dos agentes puede decidir atacarlo, ignorarlo o disputarlo. Ir al foso debe implicar tiempo fuera de línea, riesgo de daño y oportunidad para el adversario. Los valores de vida, daño, aparición, reaparición y duración de mejoras son parámetros provisionales de balance, no reglas definitivas.

### Contrato mínimo

- Estados explícitos: no aparecido, disponible, en combate, derrotado y reaparición; tiempo medido en ticks del simulador.
- Posición y ruta accesibles para ambos lados, sin crear una ventaja geométrica; comprobar distancias reales desde las bases y reflejar jugadores/semillas.
- Ambos agentes pueden atacar bajo las mismas restricciones de alcance, cobertura y proyectiles. La atribución pertenece al último impacto válido; definir desempate determinista para impactos en el mismo tick. El guardián debe poder dañar a sus atacantes con reglas y señales visibles.
- Recompensa temporal de asedio para el bando que lo derrota, con efecto preciso y acotado en robot y/o súbditos, duración explícita, visualización y eventos de inicio y fin. La recompensa no destruye el nexo ni sustituye el objetivo principal.
- Observaciones de chip: estado, tiempo hasta aparición/reaparición, distancia, vida visible, amenaza, estado de mejora y duración restante. Evitar informar vida/posición a través de una futura niebla de guerra sin regla de visión explícita.
- Acciones de chip explícitas: ir al foso, atacar al guardián, abandonar/defender. Ante objetivo ausente o fuera de alcance, definir una acción segura sin alterar el significado de otras reglas.
- Telemetría y replay: aparición, daño, muerte, autor, mejora y fin de mejora; estado del objetivo y su vida en cada muestra. El espectador debe verlo y comprender la recompensa.
- Pruebas: no aparece antes del tick pactado; llegada y daño por ambos lados; último golpe y empate deterministas; daño de vuelta, muerte y reaparición; aplicación, vencimiento y propiedad de la mejora; navegación; simetría; checksum y replay reproducibles.

## Nivel dentro de partida

El nivel representa progreso por partida, independiente del rango/ELO y del inventario persistente. Cada combate comienza en nivel 1, y el nivel se conserva tras morir solo durante esa partida. Todavía no hay valores de XP, curvas o mejoras de estadísticas aprobados.

- Fuentes candidatas: último golpe a súbditos, derrotar al rival, estructuras y Overseer. Decidir si se otorga experiencia por proximidad, cuánto y con qué reparto. Probar que ambas estrategias tengan oportunidades sin premiar estar inactivo.
- Persistir en el estado de simulación: nivel, XP acumulada y umbral siguiente; incluirlos en checksum y frames del replay. XP y umbrales han de ser enteros con límites definidos y suficientemente amplios.
- Las mejoras de vida máxima, daño, defensa y/o habilidades se aplican por reglas parametrizadas; decidir qué ocurre con la vida actual al aumentar la máxima. El visor muestra nivel, progreso y evento de subida.
- Exponer al chip `ownLevel`, `foeLevel` (según visibilidad), `ownXp` y `xpToNextLevel` únicamente cuando el motor lo implemente; no incluir nombres aspiracionales en el compilador.
- Pruebas: umbrales exactos, varias subidas por una recompensa, suma simultánea, muerte/reaparición, máximo, espejo, checksum y replay, integración de estadísticas con daño y curación.

## Compatibilidad de partidas ya jugadas

Hoy los replays se regeneran desde políticas y seed usando `DEFAULT_MOBA`; el formato de replay v2 no identifica la versión de reglas de combate. Antes de cambiar física, daño o estado, guardar un `ruleset_version` por match con una migración que asigne la versión actual a filas antiguas. Conservar y seleccionar la implementación/configuración histórica completa para simulación, cálculo de checksum y reproducción; rechazar versiones desconocidas de forma explícita. Una columna por sí sola no preserva la simulación antigua. Cubrir con fixtures de checksums reales antes y después de introducir la nueva versión, incluyendo partidas antiguas y los dos lados. Después se puede habilitar el nuevo ruleset para partidas nuevas e incluir su versión en los recibos.

## Siguiente secuencia

1. Versionar la simulación y el replay sin alterar resultados históricos; pruebas de migración y fixtures.
2. Integrar Overseer como entidad determinista, observaciones y acciones, luego viewer y telemetría; probar de extremo a extremo antes de activarlo.
3. Instrumentar duración, intentos, muertes, daño, capturas por lado y efecto sobre la victoria; ajustar el balance con múltiples seeds y políticas.
4. Implementar niveles como una iteración independiente sobre el ruleset versionado, con números de partida aprobados mediante pruebas.

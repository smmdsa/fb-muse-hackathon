# Revisión de la arena MOBA — 2026-10-29

Base revisada: `63569a00f404f381ccdf2f5e2650061293527ec8` en `feat/agent-wars-s1`. Investigación de código; no incluye playtest ni cambios de motor.

## Estado

El mapa (`packages/battle-core/src/world.ts`) mide 48×16 unidades, es simétrico y tiene cuatro coberturas. Una línea central une las bases. Cada lado tiene dos torres, inhibidor, dos torretas de nexo y nexo; la cadena de vulnerabilidad determina el avance. Las oleadas empiezan al minuto y aparecen cada 30 segundos a 30 ticks/s. La partida termina al destruir un nexo o al llegar al límite de 30 minutos, con desempate (`moba.ts`).

El controlador (`policy-driver.ts`) evalúa la primera regla coincidente por tick. PUSH acompaña oleadas, FARM busca súbditos, DEFEND busca estructuras amenazadas y RETREAT vuelve al nexo. El ataque y su prioridad son automáticos; el chip controla movimiento, dash, escudo y compras, sujeto a reglas del motor. Auto-buy está activo en la configuración por defecto. La ruta solo dobla el vector cuando detecta un obstáculo; necesita pruebas de atascos y simetría en geometrías nuevas. Las coberturas bloquean línea de visión; SEEK_COVER apunta a su centro, lo cual requiere comprobar si funciona tácticamente.

La observación de `foeLastSeenAge` es siempre cero, no una memoria real. El compilador no anuncia `foeAlive` aunque el validador y controlador lo admiten. Los cuatro rasgos DNA se guardan y presentan, pero no se leen en `drive` para decidir acciones.

## Propuesta para probar

Conservar una línea principal legible y añadir dos rutas laterales simétricas cortas, con coberturas que tengan entradas y salidas claras. Evitar prometer sigilo sin implementar visión y memoria. Añadir un objetivo central opcional con recompensa temporal moderada y temporizador explícito: debe competir con defender y empujar, no sustituir al nexo. Es una hipótesis de diseño, no funcionalidad existente.

Ampliar el contrato de observación con señales cuantificables: amenaza y agro de torres, distancia a zona segura, estado de oleadas, objetivo disponible, posición y acceso a rutas. Ofrecer intenciones explícitas como disputar objetivo, proteger oleada y retirarse a cobertura solo cuando el motor pueda ejecutarlas. Definir qué sabe cada agente, orden de reglas, prioridades de ataque y compras, desempate y versión de mapa. La simulación debe seguir determinista y sin llamadas al modelo en cada tick.

En visualización: siluetas de base y torres por equipo, alcance y agro visibles al seleccionar o en momentos críticos, hit feedback y proyectiles legibles, estado de oleadas y objetivo, y un panel que muestre regla activa y motivo usando datos de simulación. Mantener el mapa y sus colisiones como única fuente de verdad para render y motor.

## Orden y criterios de aceptación

1. Instrumentar el mapa actual: tiempos de partida, muertes, posiciones, atascos, objetivos, proporción de reglas y fallback, daño por tipo y ventaja por lado. Replay reproducible con seed y versiones.
2. Crear pruebas MOBA que inviertan lados y repitan seeds; verificar rutas, simetría, colisiones, compra, regla activa y condiciones de victoria. Registrar empates y duración; no asumir balance por pocas partidas.
3. Validar cobertura y navegación con casos de borde antes de sumar geometría; agregar pruebas de progreso y salida de obstáculos.
4. Prototipar las rutas laterales y el objetivo con métricas y playtests frente al mapa actual. Ajustar las observaciones y el esquema de reglas junto con el motor.
5. Solo entonces mejorar el viewer contra datos del mismo replay; comparar legibilidad y rendimiento.

## Relación con Muse

Muse Spark compila intención humana a reglas validadas antes de la partida; el motor ejecuta y registra. Antes de presentar el resultado como fiel al prompt, probar escenarios explícitos por regla, condiciones contradictorias y efectos visibles. La opción de explicación post-partida debe citar eventos reales; que mencione ganador y checksum no garantiza que sus demás afirmaciones sean ciertas.

El laboratorio A/B del Worker (`apps/api/src/worker.ts`) usa actualmente el simulador de duelo, no MOBA, y semillas distintas para A y B. Para comparar estrategias MOBA se necesitan las mismas semillas y ambos lados contra varios oponentes, además de métricas de incertidumbre.

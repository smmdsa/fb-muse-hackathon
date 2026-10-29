# Datos tácticos de los chips MOBA

Las reglas se evalúan en orden cada tick. Las condiciones de MOBA no están disponibles en modo duelo; si una lectura es desconocida, la condición no coincide. `WAIT` detiene el movimiento. Puede combinarse con cualquier objetivo; `NONE` detiene los disparos y `LAST_HIT` dispara solo a un súbdito enemigo visible, en alcance y con vida actual menor o igual al daño de un disparo tras la armadura de súbdito. La predicción usa la vida actual: no garantiza el último golpe, ya que el proyectil puede ser interceptado o el súbdito puede recibir otro impacto antes de su llegada.

| Observación | Significado |
|---|---|
| `inFoeTowerRange` | Hay una torre enemiga viva cuyo alcance incluye al agente; puede ser verdadera aunque todavía no esté bajo ataque. |
| `foeTowerTargetsMe` | Alguna torre enemiga viva tiene al agente como objetivo en el estado actual. |
| `foeTowerTargetsAllyMinion` | La torre enemiga viva más cercana tiene como objetivo un súbdito aliado vivo. |
| `allyMinionsUnderFoeTower` | Número de súbditos aliados vivos en alcance de la torre enemiga viva más cercana al agente; cero si no hay torre. |
| `nearAllyMinionHp`, `nearFoeMinionHp` | Suma de vida actual de súbditos vivos a distancia máxima de 6 unidades del agente. |
| `killableFoeMinionsInRange` | Número de súbditos enemigos vivos visibles y al alcance con vida actual que un disparo puede reducir a cero. |
| `nextWaveSeconds` | Tiempo hasta la próxima generación de oleada, en segundos del simulador. |
| `distOwnBase` | Distancia al nexo propio, en unidades del mapa. |
| `ownStructureThreatened` | Existe alguna estructura aliada viva con un súbdito enemigo vivo a 6 unidades o menos. |

Estas lecturas no cambian por sí solas el comportamiento: Muse debe incluirlas en condiciones y el chip debe escoger acciones. El motor continúa aplicando colisiones, alcance, daño, capacidad y el auto-buy existente. El targeting y las reglas que omiten estas nuevas funciones conservan el comportamiento anterior. Las lecturas de torre son instantáneas, no una predicción de futura adquisición de aggro: atacar al enemigo bajo torre puede hacer que el objetivo cambie en el siguiente tick.

Ejemplo: primero retroceder sin disparar cuando `foeTowerTargetsMe` sea verdadero; si no hay minions aliados en rango de la torre y está cerca, `WAIT` + `NONE`; si hay minions aliados y la torre es vulnerable, `CAPTURE` + `STRUCTURE`. La condición de proximidad evita esperar desde la base. Se trata de un ejemplo de estrategia, no una regla obligatoria del motor.

Con la implementación actual no existen el Overseer, experiencia ni nivel. Tampoco se representa la ubicación futura de oleadas ni el daño recibido por una torre en los próximos segundos; las condiciones deben usar solo las lecturas soportadas.

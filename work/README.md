# Work board

The tree is the truth. The board scan reads the files on each run. No tool stores progress.

## Layout

- `work/ROADMAP.md` holds the long horizon. The user owns it.
- `work/backlog/` holds tasks with no sprint. Each file uses the task template.
- `work/sprints/sprint-NNN/` holds one sprint. Each sprint holds epics.
- Each epic holds `todo/`, `in-progress/`, `done/`. A task file lives in one folder.

## Task states

- A file in `todo/` waits for an agent.
- A file in `in-progress/` has an owner. The owner sets the `owner` field.
- A file in `done/` meets all lines in `Done when`. The agent adds a note with the result.

## Sizes

- `work` sets agent cost: XS, S, M, L.
- `eye` sets human check cost: NONE, GLANCE, REVIEW.
- A task with an eye stays open until the user writes the verdict.

## Rules

- One task does one thing. If a task needs "and", split it.
- Each task states what it does not touch in `Not covered`.
- The agent writes a note on start and on close. A note holds numbers and file paths.
- No task closes with a red check. The agent runs the check and pastes the result.

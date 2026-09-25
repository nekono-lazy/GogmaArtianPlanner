import type { EvaluatedBonusSolution, EvaluatedSkillSolution } from './streamSolutions'

/**
 * Planner Alternative Search composition of one Route base
 * (`docs/SEARCH_SPEC.md` 5.6.8): every Ideal Bonus solution paired with every
 * Ideal Skill solution, off-axis cells (`i > 0` and `j > 0`) included, but
 * never as a precomputed Cartesian product.
 *
 * Each Ideal Bonus solution is a row that walks the Ideal Skill solutions in
 * arrival order. A row holds at most one opened cell at a time: the next cell
 * of a row opens only when the previous one settled (`onSettled`), or when the
 * Skill it waits for arrives. So the pending cells are at most one per row, a
 * consumer stop leaves the rest of the grid ungenerated, and each cell is
 * opened exactly once.
 *
 * The lower bound stays monotone. Both axes arrive in non-decreasing advance
 * order (one complete stream depth at a time), so the cost of a row's next
 * cell is never below the cell that just settled, nor below the stream depth
 * work that delivered the new solution.
 *
 * Unlike the initial Search's `createDeltaCross()`, a solution is never folded
 * into an earlier one with the same completed result: a later Counter position
 * reaching the same Bonus or Skill outcome is its own row or column, because
 * the Planner matches `RouteOperation.counterBefore` (SEARCH_SPEC 5.6.4). No
 * pair evaluation predicts anything.
 */
export function createLazyIdealCross(
  open: (
    bonus: EvaluatedBonusSolution,
    skill: EvaluatedSkillSolution,
    onSettled: () => void,
  ) => void,
) {
  const bonuses: EvaluatedBonusSolution[] = []
  const skills: EvaluatedSkillSolution[] = []
  /** The next Skill column of each row. */
  const nextColumn: number[] = []
  /** Rows whose next column has not arrived yet, in row order. */
  let waiting: number[] = []

  function openNext(row: number): void {
    const column = nextColumn[row]
    if (column >= skills.length) {
      waiting.push(row)
      return
    }
    nextColumn[row] = column + 1
    open(bonuses[row], skills[column], () => openNext(row))
  }

  return {
    addBonus(bonus: EvaluatedBonusSolution): void {
      if (!bonus.idealMatch) return
      bonuses.push(bonus)
      nextColumn.push(0)
      openNext(bonuses.length - 1)
    },
    addSkill(skill: EvaluatedSkillSolution): void {
      if (!skill.idealMatch) return
      skills.push(skill)
      const rows = waiting
      waiting = []
      for (const row of rows) openNext(row)
    },
  }
}

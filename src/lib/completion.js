// Bottom-up completion rollup: subtask -> parent task -> phase -> project.
// A leaf task (no children) is 100% if Done, else 0%. A parent task's
// completion is the hours-weighted average of its children. Phase and
// project completion are hours-weighted averages of their top-level tasks.

export function computeRollups(tasks) {
  const childrenByParent = {};
  tasks.forEach((t) => {
    if (t.parentTaskId) {
      (childrenByParent[t.parentTaskId] ||= []).push(t);
    }
  });

  const completionByTaskId = {};
  function completionFor(task) {
    if (completionByTaskId[task.id] !== undefined) return completionByTaskId[task.id];
    const children = childrenByParent[task.id] || [];
    let result;
    if (children.length === 0) {
      result = task.status === "Done" ? 100 : 0;
    } else {
      let totalWeight = 0;
      let weightedSum = 0;
      children.forEach((c) => {
        const w = c.estimatedHours || 1;
        totalWeight += w;
        weightedSum += w * completionFor(c);
      });
      result = totalWeight ? weightedSum / totalWeight : 0;
    }
    completionByTaskId[task.id] = result;
    return result;
  }

  tasks.forEach(completionFor);

  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const phaseGroups = {};
  topLevel.forEach((t) => {
    (phaseGroups[t.phase] ||= []).push(t);
  });

  const phaseCompletion = {};
  Object.entries(phaseGroups).forEach(([phase, group]) => {
    let totalWeight = 0;
    let weightedSum = 0;
    group.forEach((t) => {
      const w = t.estimatedHours || 1;
      totalWeight += w;
      weightedSum += w * completionByTaskId[t.id];
    });
    phaseCompletion[phase] = totalWeight ? weightedSum / totalWeight : 0;
  });

  let totalWeight = 0;
  let weightedSum = 0;
  topLevel.forEach((t) => {
    const w = t.estimatedHours || 1;
    totalWeight += w;
    weightedSum += w * completionByTaskId[t.id];
  });
  const projectCompletion = totalWeight ? weightedSum / totalWeight : 0;

  return { completionByTaskId, phaseCompletion, projectCompletion, childrenByParent };
}

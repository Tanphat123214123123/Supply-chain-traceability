import { Actor, ROLE_STAGES, STAGE_ORDER } from '../domain/types';
import { ConflictError, NotFoundError } from '../errors';
import { IActorRepo } from '../repository/interfaces';

/**
 * Validates the hand-off for the NEXT stage and returns the actorId that
 * should become the lot's new custodian — null if the chain is complete
 * (terminal stage) or an ADMIN deliberately left it unclaimed. Only called
 * when `newStageIndex` is a genuine forward advance, so a backfilled or
 * duplicate stage recording never disturbs the current hand-off.
 */
export async function resolveNextAssignee(
  actorRepo: IActorRepo,
  actor: Actor,
  newStageIndex: number,
  assignNextTo: string | undefined,
  options: { sameStageAllowed?: boolean } = {},
): Promise<string | null> {
  const isTerminal = newStageIndex === STAGE_ORDER.length - 1;
  if (isTerminal && !options.sameStageAllowed) return null;

  if (!assignNextTo) {
    // A merged/split/transformed lot stays with whoever made it unless handed on.
    if (options.sameStageAllowed) return actor.id;
    if (actor.role === 'ADMIN') return null;
    throw new ConflictError('You must designate who handles the next stage before completing this one');
  }

  const nextActor = await actorRepo.findById(assignNextTo);
  if (!nextActor || nextActor.tenantId !== actor.tenantId) throw new NotFoundError('Assigned actor not found');
  if (!nextActor.isActive) throw new ConflictError('Assigned actor account is inactive');

  const nextStage = STAGE_ORDER[newStageIndex + 1];
  const sameStage = STAGE_ORDER[newStageIndex];
  const canTake =
    (nextStage !== undefined && ROLE_STAGES[nextActor.role].includes(nextStage)) ||
    (options.sameStageAllowed === true && ROLE_STAGES[nextActor.role].includes(sameStage));
  if (!canTake) {
    throw new ConflictError(`${nextActor.role} cannot handle stage ${nextStage ?? sameStage}`);
  }

  return nextActor.id;
}

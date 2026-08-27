import type { TableCard, TableOwnerId } from '../../types/combat';
import type { EnemyInstance } from '../../types/enemy';
import type { SuitId } from '../../types/suits';
import { SUIT_DEFINITIONS } from '../../config/constants';
import { CardChip } from './CardChip';

interface TableDisplayProps {
  table: TableCard[];
  enemies: EnemyInstance[];
  highlightSuit: SuitId | null;
}

function ownerLabel(ownerId: TableOwnerId, enemies: EnemyInstance[]): string {
  if (ownerId === 'room') return 'Room';
  if (ownerId === 'player') return 'You';
  return enemies.find((e) => e.instanceId === ownerId)?.name ?? 'Unknown';
}

function groupBySuit(cards: TableCard[]): Map<SuitId, TableCard[]> {
  const groups = new Map<SuitId, TableCard[]>();
  for (const card of cards) {
    if (!groups.has(card.suit)) groups.set(card.suit, []);
    groups.get(card.suit)!.push(card);
  }
  return groups;
}

// One owner's play area: their own cards, grouped by suit, each suit chip
// annotated with the shared total across every owner (that combined count is
// what a claim/decay actually multiplies against -- see countTableSetSize).
function OwnerLane({
  ownerId,
  cards,
  totalBySuit,
  highlightSuit,
  enemies,
  variant,
}: {
  ownerId: TableOwnerId;
  cards: TableCard[];
  totalBySuit: Map<SuitId, number>;
  highlightSuit: SuitId | null;
  enemies: EnemyInstance[];
  variant: 'enemy' | 'room' | 'player';
}) {
  const groups = groupBySuit(cards);
  const orderedSuits = SUIT_DEFINITIONS.map((s) => s.id).filter((suitId) => groups.has(suitId));

  return (
    <div className={`table-lane table-lane--${variant}`}>
      <div className="table-lane-header">
        <span className="table-lane-name">{ownerLabel(ownerId, enemies)}</span>
        <span className="table-lane-hint">
          {ownerId === 'room'
            ? 'clears only when a play claims it'
            : `clears at ${ownerId === 'player' ? 'your' : `${ownerLabel(ownerId, enemies)}'s`} turn`}
        </span>
      </div>
      <div className="table-lane-groups">
        {orderedSuits.map((suitId) => {
          const suitCards = groups.get(suitId)!;
          const total = totalBySuit.get(suitId) ?? suitCards.length;
          const isHighlighted = highlightSuit === suitId;
          const label = SUIT_DEFINITIONS.find((s) => s.id === suitId)!.name;

          return (
            <div
              key={suitId}
              className={[
                'table-group',
                isHighlighted ? 'table-group--highlighted' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="table-group-label">
                {label} x{suitCards.length}
                {total !== suitCards.length && <span className="table-group-total"> (table total x{total})</span>}
              </div>
              <div className="table-group-cards">
                {suitCards.map((c) => (
                  <CardChip key={c.id} card={{ id: c.id, kind: 'creature', suit: c.suit }} showRider={false} />
                ))}
              </div>
            </div>
          );
        })}
        {cards.length === 0 && <div className="table-lane-empty">-- empty --</div>}
      </div>
    </div>
  );
}

// A card's owner (who played it) is core information, not a footnote -- for
// the player and each enemy it determines whose own-turn-start wipe clears
// it (see tableState's wipeOwnerTable); for the room it determines when a
// play claims it instead (see claimRoomCards). Laid out as owner lanes
// rather than suit-first groups so
// each entity's play area reads as obviously theirs, with the room's neutral
// deal sitting in the visual middle between the enemies' lanes and the
// player's, mirroring where a physical shared table would put untargeted
// cards relative to the seated players.
export function TableDisplay({ table, enemies, highlightSuit }: TableDisplayProps) {
  const totalBySuit = new Map<SuitId, number>();
  for (const card of table) totalBySuit.set(card.suit, (totalBySuit.get(card.suit) ?? 0) + 1);

  const byOwner = new Map<TableOwnerId, TableCard[]>();
  for (const card of table) {
    if (!byOwner.has(card.ownerId)) byOwner.set(card.ownerId, []);
    byOwner.get(card.ownerId)!.push(card);
  }

  const enemyOwnerIds = enemies.map((e) => e.instanceId);

  return (
    <div className="table-display">
      <h3>Table</h3>
      <div className="table-board">
        <div className="table-board-section table-board-section--enemies">
          {enemyOwnerIds.map((ownerId) => (
            <OwnerLane
              key={ownerId}
              ownerId={ownerId}
              cards={byOwner.get(ownerId) ?? []}
              totalBySuit={totalBySuit}
              highlightSuit={highlightSuit}
              enemies={enemies}
              variant="enemy"
            />
          ))}
        </div>
        <div className="table-board-section table-board-section--room">
          <OwnerLane
            ownerId="room"
            cards={byOwner.get('room') ?? []}
            totalBySuit={totalBySuit}
            highlightSuit={highlightSuit}
            enemies={enemies}
            variant="room"
          />
        </div>
        <div className="table-board-section table-board-section--player">
          <OwnerLane
            ownerId="player"
            cards={byOwner.get('player') ?? []}
            totalBySuit={totalBySuit}
            highlightSuit={highlightSuit}
            enemies={enemies}
            variant="player"
          />
        </div>
      </div>
    </div>
  );
}

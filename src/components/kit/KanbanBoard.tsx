"use client";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import WarningAmber from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { motion, useReducedMotion } from "framer-motion";
import { useId, useState } from "react";
import { money } from "@/lib/format";
import { radius } from "@/theme/tokens";

export interface KanbanColumn {
  key: string;
  label: string;
  wipLimit?: number | null;
  tone?: "default" | "gold" | "muted";
}

export interface KanbanCardData {
  id: string;
  column: string;
  value: number;
  currency?: string;
  highlight?: boolean;
}

export interface KanbanBoardProps<C extends KanbanCardData> {
  columns: KanbanColumn[];
  cards: C[];
  renderCard: (card: C) => React.ReactNode;
  /** Return false to reject the move (e.g. a stage gate opened a dialog instead). */
  onMove: (card: C, toColumn: string) => void | boolean | Promise<void | boolean>;
  canDrag?: (card: C) => boolean;
}

function Column({ col, total, count, children }: { col: KanbanColumn; total: number; count: number; children: React.ReactNode }) {
  const t = useTheme().palette.kc;
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  const over = col.wipLimit != null && count > col.wipLimit;
  return (
    <Box
      ref={setNodeRef}
      role="region"
      aria-label={`${col.label} column, ${count} deals`}
      sx={{
        width: 280,
        flexShrink: 0,
        borderRadius: `${radius.card}px`,
        bgcolor: isOver ? alpha(t.primary, 0.12) : t.surfaceGlass,
        border: `1px solid ${isOver ? t.primary : t.surfaceBorder}`,
        backdropFilter: t.surfaceBlur,
        p: 3,
        transition: "background-color 150ms, border-color 150ms",
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 220px)",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h6" component="h3" sx={{ color: col.tone === "gold" ? t.gold : undefined }}>
            {col.label}
          </Typography>
          <Typography variant="caption">
            {count} · <span className="mono">{money(total, "USD", { compact: true })}</span>
          </Typography>
        </Box>
        {over && (
          <Tooltip title={`Over WIP limit of ${col.wipLimit}`}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: t.warning }}>
              <WarningAmber fontSize="small" aria-hidden />
              <Typography variant="caption" sx={{ color: t.warning, fontWeight: 700 }}>
                WIP {count}/{col.wipLimit}
              </Typography>
            </Stack>
          </Tooltip>
        )}
      </Stack>
      <Stack spacing={2} sx={{ overflowY: "auto", minHeight: 80, pr: 0.5 }}>
        {children}
      </Stack>
    </Box>
  );
}

function DraggableCard({
  id,
  disabled,
  highlight,
  children,
}: {
  id: string;
  disabled?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme().palette.kc;
  const reduce = useReducedMotion();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <motion.div layout={!reduce} transition={{ type: "spring", stiffness: 500, damping: 35 }}>
      <Box
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        sx={{
          opacity: isDragging ? 0.35 : 1,
          cursor: disabled ? "default" : "grab",
          borderRadius: "14px",
          border: `1px solid ${highlight ? alpha(t.gold, 0.6) : t.surfaceBorder}`,
          bgcolor: alpha(t.textPrimary, 0.03),
          p: 3,
          position: "relative",
          overflow: "hidden",
          "&:hover": { bgcolor: t.surfaceHover },
          ...(highlight && !reduce
            ? {
                "&::after": {
                  content: '""',
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(110deg, transparent 30%, ${alpha(t.gold, 0.25)} 50%, transparent 70%)`,
                  animation: "kc-shimmer 1.6s ease-out 1",
                  pointerEvents: "none",
                },
                "@keyframes kc-shimmer": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(100%)" } },
              }
            : {}),
        }}
      >
        {children}
      </Box>
    </motion.div>
  );
}

/** Pipeline board: columns with totals, draggable cards, WIP warnings. Scrolls sideways on mobile. */
export function KanbanBoard<C extends KanbanCardData>({ columns, cards, renderCard, onMove, canDrag }: KanbanBoardProps<C>) {
  const [active, setActive] = useState<C | null>(null);
  const dndId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const onStart = (e: DragStartEvent) => setActive(cards.find((c) => c.id === e.active.id) ?? null);
  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as string | undefined;
    if (card && to && to !== card.column) await onMove(card, to);
  };

  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <Box
        sx={{
          display: "flex",
          gap: 3,
          overflowX: "auto",
          pb: 2,
          scrollSnapType: { xs: "x mandatory", md: "none" },
          "& > *": { scrollSnapAlign: "start" },
        }}
      >
        {columns.map((col) => {
          const inCol = cards.filter((c) => c.column === col.key);
          return (
            <Column key={col.key} col={col} count={inCol.length} total={inCol.reduce((s, c) => s + c.value, 0)}>
              {inCol.map((card) => (
                <DraggableCard key={card.id} id={card.id} disabled={canDrag ? !canDrag(card) : false} highlight={card.highlight}>
                  {renderCard(card)}
                </DraggableCard>
              ))}
            </Column>
          );
        })}
      </Box>
      <DragOverlay>
        {active ? (
          <Box sx={{ width: 256, borderRadius: "14px", p: 3, bgcolor: "background.paper", boxShadow: 6 }}>{renderCard(active)}</Box>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

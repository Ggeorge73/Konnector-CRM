"use client";
import Add from "@mui/icons-material/Add";
import Delete from "@mui/icons-material/DeleteOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveQuoteAction } from "@/app/actions/capture";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Money } from "@/components/kit";
import { lineTotals, needsMarginApproval, quoteTotals } from "@/lib/domain/quote";
import { pct } from "@/lib/format";
import type { QuoteView } from "@/lib/services/capture";

interface Line {
  item: string;
  qty: number;
  unit_cost: number;
  unit_price: number;
  oem_partner_account_id: string | null;
}

/** Quote line editor with live totals and margin guardrail. Only shown to people allowed to see cost. */
export function QuoteEditor({
  open,
  onClose,
  opportunityId,
  quote,
  marginFloor,
  partners,
}: {
  open: boolean;
  onClose: () => void;
  opportunityId: string;
  quote?: QuoteView;
  marginFloor: number;
  partners: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(quote?.title ?? "");
  const [validUntil, setValidUntil] = useState<string | null>(
    quote?.valid_until ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  );
  const [terms, setTerms] = useState(quote?.terms ?? "Net 30. Prices exclude applicable taxes. Valid for 30 days.");
  const [notes, setNotes] = useState(quote?.internal_notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    quote?.lines.map((l) => ({
      item: l.item,
      qty: l.qty,
      unit_cost: l.unit_cost ?? 0,
      unit_price: l.unit_price,
      oem_partner_account_id: l.oem_partner_account_id,
    })) ?? [{ item: "", qty: 1, unit_cost: 0, unit_price: 0, oem_partner_account_id: null }],
  );
  const save = useAction(saveQuoteAction, {
    success: quote ? "Quote updated" : "Quote drafted",
    onSuccess: (q) => router.push(`/quotes/${q.id}`),
  });
  const t = quoteTotals(lines);
  const below = needsMarginApproval(lines, marginFloor);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <FormDialog
      open={open}
      title={quote ? `Edit ${quote.number}` : "New quote"}
      subtitle="Unit cost and margin stay internal — they never appear on the client PDF or in Konnect Hub."
      onClose={onClose}
      maxWidth="lg"
      pending={save.pending}
      submitLabel="Save draft"
      onSubmit={() => save.exec(opportunityId, { title, valid_until: validUntil, terms, internal_notes: notes || null, lines }, quote?.id)}
    >
      <Text label="Title" value={title} onChange={setTitle} error={save.fieldErrors.title} required autoFocus />
      <Box sx={{ overflowX: "auto" }}>
        <Box
          component="table"
          sx={{
            width: "100%",
            minWidth: 860,
            borderCollapse: "separate",
            borderSpacing: "8px 8px",
            "& th": { textAlign: "left", fontSize: 12, color: "text.secondary", fontWeight: 600 },
          }}
        >
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 130 }}>Unit cost</th>
              <th style={{ width: 130 }}>Unit price</th>
              <th style={{ width: 170 }}>OEM / partner</th>
              <th style={{ width: 120 }}>Line total</th>
              <th style={{ width: 80 }}>Margin</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const lt = lineTotals(l);
              return (
                <tr key={i}>
                  <td>
                    <TextField
                      size="small"
                      fullWidth
                      value={l.item}
                      onChange={(e) => setLine(i, { item: e.target.value })}
                      slotProps={{ htmlInput: { "aria-label": `Line ${i + 1} item` } }}
                    />
                  </td>
                  <td>
                    <TextField
                      size="small"
                      type="number"
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: num(e.target.value) })}
                      slotProps={{ htmlInput: { "aria-label": `Line ${i + 1} quantity`, min: 0 } }}
                    />
                  </td>
                  <td>
                    <TextField
                      size="small"
                      type="number"
                      value={l.unit_cost}
                      onChange={(e) => setLine(i, { unit_cost: num(e.target.value) })}
                      slotProps={{ htmlInput: { "aria-label": `Line ${i + 1} unit cost`, min: 0 } }}
                    />
                  </td>
                  <td>
                    <TextField
                      size="small"
                      type="number"
                      value={l.unit_price}
                      onChange={(e) => setLine(i, { unit_price: num(e.target.value) })}
                      slotProps={{ htmlInput: { "aria-label": `Line ${i + 1} unit price`, min: 0 } }}
                    />
                  </td>
                  <td>
                    <TextField
                      size="small"
                      select
                      fullWidth
                      value={l.oem_partner_account_id ?? ""}
                      onChange={(e) => setLine(i, { oem_partner_account_id: e.target.value || null })}
                      slotProps={{ htmlInput: { "aria-label": `Line ${i + 1} partner` } }}
                    >
                      <MenuItem value="">—</MenuItem>
                      {partners.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </td>
                  <td>
                    <Money value={lt.price} variant="body2" />
                  </td>
                  <td>
                    <Typography variant="body2" color={lt.marginPct < marginFloor ? "warning.main" : "success.main"} fontWeight={700}>
                      {pct(lt.marginPct, 1)}
                    </Typography>
                  </td>
                  <td>
                    <IconButton
                      size="small"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
      <Button
        startIcon={<Add />}
        onClick={() => setLines((ls) => [...ls, { item: "", qty: 1, unit_cost: 0, unit_price: 0, oem_partner_account_id: null }])}
        sx={{ alignSelf: "flex-start" }}
      >
        Add line
      </Button>
      <Stack direction="row" spacing={6} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
        <Box>
          <Typography variant="caption">Cost</Typography>
          <Money value={t.cost} component="p" />
        </Box>
        <Box>
          <Typography variant="caption">Price</Typography>
          <Money value={t.price} component="p" fontWeight={700} />
        </Box>
        <Box>
          <Typography variant="caption">Margin</Typography>
          <Typography variant="mono" component="p">
            {pct(t.marginPct, 1)}
          </Typography>
        </Box>
      </Stack>
      {below && (
        <Alert severity="warning">
          Margin is below the {marginFloor}% floor. Submitting will route this quote to an executive for approval.
        </Alert>
      )}
      {save.fieldErrors.lines && <Alert severity="error">{save.fieldErrors.lines}</Alert>}
      <DateField label="Valid until" value={validUntil} onChange={setValidUntil} />
      <Text label="Client terms" value={terms} onChange={setTerms} multiline minRows={2} />
      <Text label="Internal notes (never shared)" value={notes} onChange={setNotes} multiline minRows={2} />
    </FormDialog>
  );
}

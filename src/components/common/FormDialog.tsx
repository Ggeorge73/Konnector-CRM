"use client";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export function FormDialog({
  open,
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel = "Save",
  pending,
  children,
  maxWidth = "sm",
  danger,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  pending?: boolean;
  children: React.ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg";
  danger?: boolean;
}) {
  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth={maxWidth} aria-labelledby="form-dialog-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        noValidate
      >
        <DialogTitle id="form-dialog-title" sx={{ fontWeight: 700 }}>
          {title}
          {subtitle && (
            <Typography variant="caption" component="p">
              {subtitle}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 6, pb: 5 }}>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color={danger ? "error" : "primary"} disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

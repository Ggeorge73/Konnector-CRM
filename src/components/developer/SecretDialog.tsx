"use client";
import ContentCopy from "@mui/icons-material/ContentCopy";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useToast } from "@/components/common/Toast";
import { radius } from "@/theme/tokens";

/** Shows a secret exactly once, with a copy button. Closing it is the last chance to see it. */
export function SecretDialog({
  open,
  title,
  label,
  secret,
  hint,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  secret: string;
  hint: React.ReactNode;
  onClose: () => void;
}) {
  const t = useTheme().palette.kc;
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Couldn't copy — select the text and copy it manually", "error");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="secret-dialog-title">
      <DialogTitle id="secret-dialog-title" sx={{ fontWeight: 700 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Stack
            direction="row"
            spacing={2}
            alignItems="flex-start"
            sx={{
              p: 3,
              borderRadius: `${radius.input}px`,
              bgcolor: alpha(t.warning, 0.12),
              border: `1px solid ${alpha(t.warning, 0.32)}`,
            }}
          >
            <KeyOutlined fontSize="small" sx={{ color: t.warning, mt: 0.25 }} />
            <Typography variant="body2">
              Copy it now — this is the only time it&apos;s shown. Only a one-way hash is stored, so it can&apos;t be recovered later.
            </Typography>
          </Stack>
          <Box
            component="code"
            aria-label={label}
            data-secret
            sx={{
              display: "block",
              p: 3,
              borderRadius: `${radius.input}px`,
              border: `1px solid ${t.surfaceBorder}`,
              bgcolor: t.surfaceHover,
              typography: "mono",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {secret}
          </Box>
          <Typography variant="body2" color="text.secondary" component="div">
            {hint}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 5 }}>
        <Button startIcon={<ContentCopy />} onClick={copy}>
          Copy
        </Button>
        <Button variant="contained" onClick={onClose}>
          I&apos;ve saved it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

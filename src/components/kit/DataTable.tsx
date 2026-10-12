"use client";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import {
  DataGrid,
  GridToolbarColumnsButton,
  GridToolbarContainer,
  GridToolbarExport,
  GridToolbarFilterButton,
  GridToolbarQuickFilter,
  type DataGridProps,
  type GridValidRowModel,
} from "@mui/x-data-grid";
import { radius } from "@/theme/tokens";

function Toolbar({ extra, fileName }: { extra?: React.ReactNode; fileName?: string }) {
  return (
    <GridToolbarContainer sx={{ px: 3, pt: 3, pb: 1, gap: 2, flexWrap: "wrap" }}>
      <GridToolbarQuickFilter debounceMs={200} />
      <Box sx={{ flex: 1 }} />
      {extra}
      <GridToolbarColumnsButton />
      <GridToolbarFilterButton />
      <GridToolbarExport csvOptions={{ fileName: fileName ?? "export", utf8WithBom: true }} printOptions={{ disableToolbarButton: true }} />
    </GridToolbarContainer>
  );
}

export interface DataTableProps<R extends GridValidRowModel> extends DataGridProps<R> {
  toolbarExtra?: React.ReactNode;
  exportName?: string;
}

/** MUI X DataGrid styled to glass: quick filter, column chooser, CSV export, keyboard navigation. */
export function DataTable<R extends GridValidRowModel>({ toolbarExtra, exportName, sx, slotProps, ...rest }: DataTableProps<R>) {
  const t = useTheme().palette.kc;
  return (
    <DataGrid<R>
      autoHeight
      density="compact"
      disableRowSelectionOnClick
      pageSizeOptions={[25, 50, 100]}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      slots={{ toolbar: Toolbar as never }}
      slotProps={{ toolbar: { extra: toolbarExtra, fileName: exportName } as never, ...slotProps }}
      sx={{
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: `${radius.card}px`,
        bgcolor: t.surfaceGlass,
        backdropFilter: t.surfaceBlur,
        "--DataGrid-containerBackground": "transparent",
        "& .MuiDataGrid-columnHeaders": { borderColor: t.surfaceBorder },
        "& .MuiDataGrid-columnHeaderTitle": {
          fontWeight: 700,
          fontSize: 12,
          color: t.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        },
        "& .MuiDataGrid-cell": { borderColor: t.surfaceBorder, display: "flex", alignItems: "center" },
        "& .MuiDataGrid-row:hover": { bgcolor: t.surfaceHover },
        "& .MuiDataGrid-row.Mui-selected": { bgcolor: alpha(t.primary, 0.12) },
        "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": { outline: `2px solid ${t.accent}`, outlineOffset: -2 },
        "& .MuiDataGrid-footerContainer": { borderColor: t.surfaceBorder },
        "& .mono": { fontFamily: "var(--font-mono), monospace", fontSize: 13 },
        ...sx,
      }}
      {...rest}
    />
  );
}

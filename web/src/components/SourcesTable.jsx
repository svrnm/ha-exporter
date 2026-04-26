import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { formatCurrency, formatKwh } from '../format.js';

/**
 * Compact list of named statistics and their total over the selected range.
 *
 * rows: [{
 *   label: string,
 *   value: number|null,
 *   accent?: string,
 *   unit?: string,
 *   cost?: number|null,
 *   costKind?: 'savings'|'spend'
 * }]
 */
export function SourcesTable({
  rows = [],
  title,
  currency = 'EUR',
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const cellPad = compact ? { py: 0.4, px: 1 } : undefined;
  const headSx = {
    color: 'text.secondary',
    ...(compact ? { py: 0.5, typography: 'caption', fontWeight: 600 } : {}),
  };

  return (
    <Paper sx={{ p: compact ? { xs: 1.25, sm: 1.5 } : { xs: 2, sm: 2.5 }, height: '100%' }}>
      <Stack spacing={compact ? 1 : 1.5} sx={{ height: '100%' }}>
        <Typography variant={compact ? 'body2' : 'subtitle1'} sx={{ fontWeight: 700 }}>
          {title ?? t('summary.sources')}
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={headSx}>{t('summary.source')}</TableCell>
                <TableCell align="right" sx={headSx}>
                  {t('summary.consumption')}
                </TableCell>
                <TableCell align="right" sx={headSx}>
                  {t('summary.cost')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    sx={{ color: 'text.secondary', py: compact ? 2 : 3 }}
                    align="center"
                  >
                    {t('summary.noData')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={cellPad}>
                      <Stack direction="row" spacing={compact ? 0.75 : 1.25} alignItems="center">
                        <Box
                          sx={{
                            width: compact ? 7 : 10,
                            height: compact ? 7 : 10,
                            borderRadius: '50%',
                            bgcolor: row.accent || theme.palette.text.primary,
                            flexShrink: 0,
                          }}
                        />
                        <Typography
                          component="span"
                          variant={compact ? 'caption' : 'body2'}
                          sx={{ lineHeight: 1.25 }}
                        >
                          {row.label}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell
                      align="right"
                      className="num"
                      sx={{
                        ...cellPad,
                        ...(compact ? { typography: 'caption', fontFeatureSettings: '"tnum"' } : {}),
                      }}
                    >
                      {row.value == null
                        ? '—'
                        : `${formatKwh(row.value, i18n.language)} ${row.unit ?? t('units.kwh')}`}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="num"
                      sx={{
                        ...cellPad,
                        color:
                          row.costKind === 'savings' && row.cost != null
                            ? 'success.main'
                            : undefined,
                        ...(compact ? { typography: 'caption', fontFeatureSettings: '"tnum"' } : {}),
                      }}
                    >
                      {row.cost == null || !Number.isFinite(row.cost)
                        ? '—'
                        : formatCurrency(row.cost, i18n.language, currency)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </Paper>
  );
}

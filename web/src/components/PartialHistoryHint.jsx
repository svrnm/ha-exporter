import { useState } from 'react';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

const THRESHOLD_MS = 3_600_000;

/**
 * Small control that opens the partial-statistics explanation in a popover.
 * Renders nothing when coverage lag is below the threshold.
 *
 * @param {{ lagMs: number; disabled?: boolean }} props
 */
export function PartialHistoryHint({ lagMs, disabled = false }) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState(null);

  if (disabled || lagMs < THRESHOLD_MS) return null;

  const open = Boolean(anchorEl);
  const hours = (lagMs / THRESHOLD_MS).toFixed(1);
  const body = t('summary.partialStatisticHistory', { hours });

  return (
    <Box
      sx={{
        flexShrink: 0,
        alignSelf: 'center',
        lineHeight: 0,
      }}
    >
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={t('summary.partialHistoryAria')}
        aria-expanded={open}
        aria-haspopup="true"
        sx={(theme) => ({
          color: 'warning.main',
          '&:hover': {
            color: 'warning.dark',
            bgcolor: alpha(theme.palette.warning.main, 0.12),
          },
        })}
      >
        <WarningAmberOutlined sx={{ fontSize: 20 }} />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { maxWidth: 440, p: 2 },
          },
        }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          {t('summary.partialHistoryTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Popover>
    </Box>
  );
}

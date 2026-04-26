import { Paper, Stack, Typography, Box, Skeleton } from '@mui/material';

export function StatCard({ icon, label, value, unit, accent, caption, loading }) {
  return (
    <Paper sx={{ p: { xs: 2, sm: 2.5 }, height: '100%' }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          {icon ? (
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: accent ? `${accent}22` : 'action.hover',
                color: accent || 'text.primary',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
          ) : null}
          <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="baseline" spacing={0.75}>
          {loading ? (
            <Skeleton variant="text" width={100} height={40} />
          ) : (
            <Typography
              variant="h4"
              className="num"
              sx={{ fontWeight: 700, lineHeight: 1.1 }}
            >
              {value}
            </Typography>
          )}
          {unit ? (
            <Typography variant="body2" color="text.secondary">
              {unit}
            </Typography>
          ) : null}
        </Stack>
        {caption ? (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

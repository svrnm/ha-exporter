import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import BoltIcon from '@mui/icons-material/Bolt';

import { useAuth } from './AuthProvider.jsx';
import { createClient, ApiError } from '../api/client.js';

export function Login() {
  const { t } = useTranslation();
  const { isAuthed, setToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [value, setValue] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (isAuthed) {
    const from = location.state?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // Validate by calling any authed endpoint with the candidate token.
      const probe = createClient({ getToken: () => trimmed });
      await probe.request('/instances');
      setToken(trimmed);
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('login.invalid'));
      } else {
        setError(t('login.offline'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container maxWidth="sm" sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center' }}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%' }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: 'primary.main',
                display: 'grid',
                placeItems: 'center',
                color: 'common.black',
              }}
            >
              <BoltIcon />
            </Box>
            <Box>
              <Typography variant="h6">{t('app.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('login.title')}
              </Typography>
            </Box>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {t('login.description')}
          </Typography>

          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label={t('login.tokenLabel')}
                type={showToken ? 'text' : 'password'}
                autoFocus
                autoComplete="off"
                fullWidth
                value={value}
                onChange={(e) => setValue(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowToken((s) => !s)}
                        edge="end"
                        aria-label="toggle token visibility"
                      >
                        {showToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || !value.trim()}
              >
                {t('login.submit')}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}

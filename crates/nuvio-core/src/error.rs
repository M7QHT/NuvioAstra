use thiserror::Error;

/// Errors of the core. Messages never contain addon URLs: configured addons often carry
/// credentials in their path or query.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid payload: {0}")]
    InvalidPayload(String),
    #[error("missing required field `{0}`")]
    MissingField(String),
    #[error("network error ({kind})")]
    Network { kind: NetworkErrorKind },
    #[error("HTTP status {status}")]
    HttpStatus { status: u16 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkErrorKind {
    Timeout,
    Connect,
    Body,
    Other,
}

impl std::fmt::Display for NetworkErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Timeout => "timeout",
            Self::Connect => "connection failed",
            Self::Body => "body read failed",
            Self::Other => "request failed",
        })
    }
}

impl From<reqwest::Error> for CoreError {
    fn from(error: reqwest::Error) -> Self {
        // reqwest errors include the URL; keep only the kind so credentials never reach logs.
        let kind = if error.is_timeout() {
            NetworkErrorKind::Timeout
        } else if error.is_connect() {
            NetworkErrorKind::Connect
        } else if error.is_body() || error.is_decode() {
            NetworkErrorKind::Body
        } else {
            NetworkErrorKind::Other
        };
        match error.status() {
            Some(status) => CoreError::HttpStatus { status: status.as_u16() },
            None => CoreError::Network { kind },
        }
    }
}

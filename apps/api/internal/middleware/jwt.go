package middleware

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/nextplay/api/internal/authctx"
)

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Crv string `json:"crv"`
	N   string `json:"n"`
	E   string `json:"e"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type jwks struct {
	Keys []jwk `json:"keys"`
}

type cachedKey struct {
	Key       any
	ExpiresAt time.Time
}

var (
	jwksCacheMu sync.RWMutex
	jwksCache   = map[string]cachedKey{}
)

func fetchPublicKey(jwksURL, kid string) (any, error) {
	cacheKey := jwksURL + "|" + kid
	now := time.Now()

	jwksCacheMu.RLock()
	if c, ok := jwksCache[cacheKey]; ok && now.Before(c.ExpiresAt) {
		jwksCacheMu.RUnlock()
		return c.Key, nil
	}
	jwksCacheMu.RUnlock()

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(jwksURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks fetch failed: %d", resp.StatusCode)
	}

	var set jwks
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}

	for _, key := range set.Keys {
		if key.Kid != kid {
			continue
		}
		var pub any
		switch key.Kty {
		case "RSA":
			nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
			if err != nil {
				return nil, err
			}
			eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
			if err != nil {
				return nil, err
			}
			n := new(big.Int).SetBytes(nBytes)
			e := 0
			for _, b := range eBytes {
				e = e<<8 + int(b)
			}
			pub = &rsa.PublicKey{N: n, E: e}
		case "EC":
			var curve elliptic.Curve
			switch key.Crv {
			case "P-256":
				curve = elliptic.P256()
			case "P-384":
				curve = elliptic.P384()
			case "P-521":
				curve = elliptic.P521()
			default:
				return nil, errors.New("unsupported jwk curve")
			}
			xBytes, err := base64.RawURLEncoding.DecodeString(key.X)
			if err != nil {
				return nil, err
			}
			yBytes, err := base64.RawURLEncoding.DecodeString(key.Y)
			if err != nil {
				return nil, err
			}
			x := new(big.Int).SetBytes(xBytes)
			y := new(big.Int).SetBytes(yBytes)
			if !curve.IsOnCurve(x, y) {
				return nil, errors.New("invalid ec jwk point")
			}
			pub = &ecdsa.PublicKey{Curve: curve, X: x, Y: y}
		default:
			return nil, errors.New("unsupported jwk key type")
		}

		jwksCacheMu.Lock()
		jwksCache[cacheKey] = cachedKey{
			Key:       pub,
			ExpiresAt: now.Add(10 * time.Minute),
		}
		jwksCacheMu.Unlock()

		return pub, nil
	}
	return nil, errors.New("kid not found in jwks")
}

func JWT(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			h := r.Header.Get("Authorization")
			if h == "" || !strings.HasPrefix(strings.ToLower(h), "bearer ") {
				http.Error(w, `{"error":"missing bearer token"}`, http.StatusUnauthorized)
				return
			}
			raw := strings.TrimSpace(h[7:])

			// Parse unverified first to route validation by alg/issuer.
			unverified := jwt.MapClaims{}
			parsed, _, err := new(jwt.Parser).ParseUnverified(raw, unverified)
			if err != nil {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			alg, _ := parsed.Header["alg"].(string)
			var tok *jwt.Token
			switch alg {
			case jwt.SigningMethodHS256.Alg():
				tok, err = jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
					if t.Method != jwt.SigningMethodHS256 {
						return nil, jwt.ErrSignatureInvalid
					}
					return []byte(secret), nil
				}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
			case jwt.SigningMethodRS256.Alg(), jwt.SigningMethodES256.Alg():
				iss, _ := unverified["iss"].(string)
				if iss == "" {
					http.Error(w, `{"error":"invalid token issuer"}`, http.StatusUnauthorized)
					return
				}
				kid, _ := parsed.Header["kid"].(string)
				if kid == "" {
					http.Error(w, `{"error":"missing token kid"}`, http.StatusUnauthorized)
					return
				}
				jwksURL := strings.TrimRight(iss, "/") + "/.well-known/jwks.json"
				tok, err = jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
					if t.Method.Alg() != jwt.SigningMethodRS256.Alg() &&
						t.Method.Alg() != jwt.SigningMethodES256.Alg() {
						return nil, jwt.ErrTokenSignatureInvalid
					}
					return fetchPublicKey(jwksURL, kid)
				}, jwt.WithValidMethods([]string{
					jwt.SigningMethodRS256.Alg(),
					jwt.SigningMethodES256.Alg(),
				}))
			default:
				http.Error(w, `{"error":"unsupported token algorithm"}`, http.StatusUnauthorized)
				return
			}

			if err != nil || !tok.Valid {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			claims, ok := tok.Claims.(jwt.MapClaims)
			if !ok {
				http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
				return
			}
			sub, _ := claims["sub"].(string)
			if sub == "" {
				http.Error(w, `{"error":"invalid subject"}`, http.StatusUnauthorized)
				return
			}
			r = r.WithContext(authctx.WithUser(r.Context(), authctx.User{ID: sub}))
			next.ServeHTTP(w, r)
		})
	}
}

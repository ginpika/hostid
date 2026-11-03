[Documentation](./README.md) · **English** · [简体中文](./zh-CN/sso-integration-java.md)

# Java SSO integration

Complete [shared-session SSO](./sso.md) configuration first. This minimal JDK 17 example validates the shared cookie on the backend before returning user information. It uses the JDK HTTP server/client and Jackson for JSON.

## Project

Create `pom.xml`:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>hostid-sso</artifactId><version>1.0</version>
  <properties><maven.compiler.release>17</maven.compiler.release></properties>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId><version>2.21.4</version>
    </dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
    <plugin><groupId>org.codehaus.mojo</groupId>
      <artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin>
  </plugins></build>
</project>
```

Create `src/main/java/Main.java`, replacing the HostID URL and cookie name:

```java
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;

public class Main {
    static final URI SESSION = URI.create("https://mail.example.com/api/sso/session");
    static final String COOKIE = "sso_token";
    static final ObjectMapper JSON = new ObjectMapper();
    static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER).build();

    static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) { output.write(bytes); }
    }

    static void me(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("GET") ||
                !exchange.getRequestURI().getPath().equals("/api/me")) {
            reply(exchange, 404, "{\"error\":\"Not found\"}"); return;
        }
        String token = exchange.getRequestHeaders().getOrDefault("Cookie", List.of())
            .stream().flatMap(h -> Arrays.stream(h.split(";"))).map(String::trim)
            .filter(c -> c.startsWith(COOKIE + "="))
            .map(c -> c.substring(COOKIE.length() + 1)).findFirst().orElse("");
        if (token.length() > 4096 || !token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) {
            reply(exchange, 401, "{\"error\":\"Sign in required\"}"); return;
        }
        try {
            var request = HttpRequest.newBuilder(SESSION).timeout(Duration.ofSeconds(5))
                .header("Cookie", COOKIE + "=" + token)
                .header("Accept", "application/json").GET().build();
            var response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IOException("Upstream error");
            JsonNode session = JSON.readTree(response.body());
            if (session == null || !session.path("authenticated").isBoolean()) {
                throw new IOException("Invalid session response");
            }
            if (!session.path("authenticated").booleanValue()) {
                reply(exchange, 401, "{\"error\":\"Sign in required\"}"); return;
            }
            JsonNode user = session.path("user");
            if (!user.path("id").isTextual() || user.path("id").asText().isBlank()) {
                throw new IOException("Invalid session response");
            }
            reply(exchange, 200, JSON.writeValueAsString(user));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            reply(exchange, 503, "{\"error\":\"Session service unavailable\"}");
        } catch (Exception error) {
            reply(exchange, 503, "{\"error\":\"Session service unavailable\"}");
        }
    }

    public static void main(String[] args) throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8080), 0);
        server.createContext("/api/me", Main::me);
        server.start();
    }
}
```

```bash
mvn compile exec:java -Dexec.mainClass=Main
```

Put this server behind HTTPS at `app.example.com`. Set HostID's shared cookie domain to `example.com`, then open `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme` in the browser. The application returns 401 without a valid session and 503 when upstream validation fails.

Only the named cookie is forwarded to a fixed HTTPS endpoint; redirects are disabled. Use the validated user ID for your application's permissions. For a Spring application, place the same validation in a filter/interceptor before the protected handler and attach the validated user to the server-side request.

Follow the common guide for [logout, local sessions and CSRF considerations](./sso.md#browser-requests-and-logout).

Contract: [SSO routes](../backend/src/routes/sso.ts).

[文档首页](./README.md) · [English](../sso-integration-java.md) · **简体中文**

# Java SSO 集成

先完成[共享会话 SSO](./sso.md)配置。这个最小 JDK 17 示例在后端验证共享 Cookie，通过后才返回用户资料。HTTP 服务与客户端使用 JDK 自带实现，JSON 解析使用 Jackson。

## 项目

创建 `pom.xml`：

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

创建 `src/main/java/Main.java`，替换 HostID URL 和 Cookie 名称：

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

在 `app.example.com` 通过 HTTPS 反向代理此服务。将 HostID 的共享 Cookie 域设为 `example.com`，再用浏览器打开 `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`。没有有效会话时应用返回 401，上游验证异常时返回 503。

仅将指定 Cookie 转发至固定 HTTPS 端点，并禁止重定向。使用验证后的用户 ID 执行应用自己的权限规则。Spring 应用可将相同验证逻辑放入过滤器或拦截器，在受保护处理器执行前完成验证，并将用户附加到服务端请求。

[登出、本地会话与 CSRF 注意事项](./sso.md#浏览器请求与登出)见公共指南。

接口依据：[SSO 路由](../../backend/src/routes/sso.ts)。

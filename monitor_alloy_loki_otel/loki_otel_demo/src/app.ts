// src/app.ts
import express from 'express';
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';

// 设置 OpenTelemetry 诊断日志
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// 配置 OpenTelemetry 追踪
const traceProvider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'user-action-tracker',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
});

const traceExporter = new OTLPTraceExporter({
  url: 'http://localhost:4317', // OTLP gRPC 端点
});

traceProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
traceProvider.register();

// 配置 OpenTelemetry 指标
const meterProvider = new MeterProvider();
const metricExporter = new OTLPMetricExporter({
  url: 'http://localhost:4317',
});
meterProvider.addMetricReader(new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 5000,
}));

// 配置 OpenTelemetry 日志
const loggerProvider = new LoggerProvider();
const logExporter = new OTLPLogExporter({
  url: 'http://localhost:4317',
});
loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter));

// 仪表化 Express
registerInstrumentations({
  meterProvider,
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation({
      requestHook: (span, request) => {
        if (request.route?.path) {
          span.setAttribute('http.route', request.route.path);
        }
      },
      responseHook: (span, response) => {
        span.setAttribute('http.status_code', response.statusCode);
      }
    }),
  ],
});

const app = express();
const port = 3000;

// 添加中间件确保所有路由都有追踪
app.use((req, res, next) => {
  const tracer = trace.getTracer('express-tracer');
  const span = tracer.startSpan(`${req.method} ${req.path}`);
  context.with(trace.setSpan(context.active(), span), () => {
    next();
    span.end();
  });
});

// 健康检查端点（无追踪）
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  // 安全地获取当前活动的 span
  const activeSpan = trace.getActiveSpan();
  
  if (activeSpan) {
    activeSpan.setAttribute('enduser.id', 'guest');
    activeSpan.addEvent('home_page_accessed');
  }
  
  res.send('Home Page');
});

app.get('/user/:id', (req, res) => {
  const { id } = req.params;
  const tracer = trace.getTracer('user-tracer');
  
  // 创建新 span 追踪用户操作
  const span = tracer.startSpan('process_user_request', {
    attributes: {
      'user.id': id,
      'http.method': req.method,
    },
  });

  // 添加日志
  const logger = loggerProvider.getLogger('user-logger');
  logger.emit({
    severityNumber: 1, // INFO
    severityText: 'INFO',
    body: `Processing user ${id}`,
    attributes: { userId: id, route: '/user/:id' }
  });

  // 添加自定义指标
  const meter = meterProvider.getMeter('user-metrics');
  const requestCounter = meter.createCounter('user.requests.count', {
    description: 'Count of user requests',
  });
  requestCounter.add(1, { userId: id });

  // 模拟业务逻辑
  context.with(trace.setSpan(context.active(), span), () => {
    try {
      // 业务逻辑
      if (parseInt(id) % 2 === 0) {
        tracer.startActiveSpan('premium_check', (premiumSpan) => {
          premiumSpan.setAttribute('user.tier', 'premium');
          premiumSpan.end();
        });
        res.send(`Premium User ${id}`);
      } else {
        res.send(`Regular User ${id}`);
      }
      
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      res.status(500).send('Internal Server Error');
    } finally {
      span.end();
    }
  });
});

// 性能监控端点
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send('# Placeholder for actual metrics endpoint\n');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
# 添加日志配置
from flask import Flask
import logging
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter

app = Flask(__name__)
# 设置日志
logger_provider = LoggerProvider()
set_logger_provider(logger_provider)

log_exporter = OTLPLogExporter(endpoint="http://localhost:4317", insecure=True)
logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))

# 将OTLP处理器添加到Python日志
handler = LoggingHandler(logger_provider=logger_provider)
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)

FlaskInstrumentor().instrument_app(app)

# 在路由中添加日志
@app.route("/user/<id>")
def user_profile(id):
    tracer = trace.get_tracer(__name__)
    with tracer.start_as_current_span("user_profile") as span:
        span.set_attribute("user.id", id)
        logging.info(f"Processing user {id}", extra={
            "http.route": "/user/<id>",
            "user.id": id
        })
        # 模拟业务逻辑
        if int(id) % 2 == 0:
            with tracer.start_as_current_span("premium_user_check"):
                return f"Premium User {id}"
        return f"User Profile {id}"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4000, debug=True)

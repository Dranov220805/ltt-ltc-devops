package simulations

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.concurrent.duration._

class SeatReservationSimulation extends Simulation {
  private val baseUrl = System.getProperty("baseUrl", "http://localhost:3000")
  private val users = Integer.getInteger("users", 10)

  private val httpProtocol = http
    .baseUrl(baseUrl)
    .acceptHeader("application/json")
    .userAgentHeader("gatling-seat-reservation-test")

  private val seatFlow = scenario("Seat Reservation Contention Flow")
    .exec(http("health-check").get("/health").check(status.in(200, 204)))
    .pause(1, 3)
    .exec(
      http("reserve-seat")
        .post("/api/showtimes/seat-lock")
        .header("Content-Type", "application/json")
        .body(StringBody("""{"showtimeId":"stress-show-01","seatId":"A10"}"""))
        .check(status.in(200, 201, 409))
    )
    .pause(5, 15)
    .exec(
      http("release-or-confirm")
        .post("/api/showtimes/seat-release")
        .header("Content-Type", "application/json")
        .body(StringBody("""{"showtimeId":"stress-show-01","seatId":"A10"}"""))
        .check(status.in(200, 204, 404))
    )

  setUp(
    seatFlow.inject(rampUsers(users).during(60.seconds))
  ).protocols(httpProtocol)
}

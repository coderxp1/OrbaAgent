from orba_gpu import fw_wg_verify as v

UFW_BASE = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp (wg-orba)         ALLOW IN    10.77.0.1 -> 10.77.0.2
"""

UFW_NUMBERED = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 51820/udp                  ALLOW IN    85.215.156.241
[ 2] 8190/tcp (wg-orba)         ALLOW IN    10.77.0.1 -> 10.77.0.2
"""

UFW_VERBOSE = """Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW IN    85.215.156.241             # OrbaAgent WG
8190/tcp on wg-orba        ALLOW IN    10.77.0.1 to 10.77.0.2     # OrbaAgent worker
"""

# Adversarial / Reject fixtures
UFW_PUBLIC_ANYWHERE = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp                   ALLOW       Anywhere
"""

UFW_PUBLIC_CIDR = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp                   ALLOW       0.0.0.0/0
"""

UFW_WRONG_INTERFACE = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp (eth0)            ALLOW IN    10.77.0.1 -> 10.77.0.2
"""

UFW_WRONG_PEER = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp (wg-orba)         ALLOW IN    10.77.0.99 -> 10.77.0.2
"""

UFW_EXTRA_RULE = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp (wg-orba)         ALLOW IN    10.77.0.1 -> 10.77.0.2
8190/tcp                   ALLOW       192.168.1.100
"""

UFW_UDP_ANYWHERE = """Status: active

To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       Anywhere
8190/tcp (wg-orba)         ALLOW IN    10.77.0.1 -> 10.77.0.2
"""

UFW_INACTIVE = """Status: inactive
"""


def test_ufw_enabled():
    assert v.parse_ufw_enabled(UFW_BASE)
    assert v.parse_ufw_enabled(UFW_NUMBERED)
    assert v.parse_ufw_enabled(UFW_VERBOSE)
    assert not v.parse_ufw_enabled(UFW_INACTIVE)


def test_udp_51820_only_production():
    assert v.verify_udp_51820_from_production(UFW_BASE)
    assert v.verify_udp_51820_from_production(UFW_NUMBERED)
    assert v.verify_udp_51820_from_production(UFW_VERBOSE)
    # Reject non-production / anywhere
    assert not v.verify_udp_51820_from_production(UFW_UDP_ANYWHERE)
    assert not v.verify_udp_51820_from_production(
        "51820/udp ALLOW 1.2.3.4\n51820/udp ALLOW 85.215.156.241"
    )


def test_tcp_8190_valid_formats():
    assert v.verify_tcp_8190_tunnel_only(UFW_BASE)
    assert v.verify_tcp_8190_tunnel_only(UFW_NUMBERED)
    assert v.verify_tcp_8190_tunnel_only(UFW_VERBOSE)


def test_tcp_8190_rejects_adversarial_rules():
    assert not v.verify_tcp_8190_tunnel_only(UFW_PUBLIC_ANYWHERE), "Must reject Anywhere"
    assert not v.verify_tcp_8190_tunnel_only(UFW_PUBLIC_CIDR), "Must reject 0.0.0.0/0"
    assert not v.verify_tcp_8190_tunnel_only(UFW_WRONG_INTERFACE), "Must reject wrong interface"
    assert not v.verify_tcp_8190_tunnel_only(UFW_WRONG_PEER), "Must reject wrong peer"
    assert not v.verify_tcp_8190_tunnel_only(UFW_EXTRA_RULE), "Must reject extra 8190 rule"
    assert not v.verify_tcp_8190_tunnel_only(""), "Must reject empty status"


def test_wireguard_checks():
    systemctl_text = "Active: active (running)"
    ip_link_text = "2: wg-orba: <POINTOPOINT,MULTICAST,UP> mtu 1420 qdisc noqueue state UNKNOWN group default qlen 500"
    ip_addr_text = "inet 10.77.0.2/32 scope global wg-orba"

    assert v.verify_wireguard_active(systemctl_text)
    assert v.verify_wg_interface_present(ip_link_text)
    assert v.verify_wg_address(ip_addr_text)
    assert v.verify_all(UFW_BASE, systemctl_text, ip_link_text, ip_addr_text)

    # Negative checks
    assert not v.verify_wireguard_active("Active: inactive (dead)")
    assert not v.verify_wg_interface_present("1: eth0: <BROADCAST>")
    assert not v.verify_wg_address("inet 10.77.0.99/32 scope global wg-orba")


def run_all():
    test_ufw_enabled()
    test_udp_51820_only_production()
    test_tcp_8190_valid_formats()
    test_tcp_8190_rejects_adversarial_rules()
    test_wireguard_checks()
    print("ALL FW/WG VERIFICATION TESTS PASSED")


if __name__ == "__main__":
    run_all()

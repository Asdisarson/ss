# API Status Display Setup

## Hardware Requirements
- Raspberry Pi (any model)
- 2.5-inch ILI9341 Display
- Jumper wires

## Display Connection Guide
Connect your 2.5-inch display to the Raspberry Pi's GPIO pins as follows:

```
Display Pin  ->  Raspberry Pi GPIO
VCC         ->  3.3V (Pin 1)
GND         ->  Ground (Pin 6)
CS          ->  CE0 (Pin 24)
RESET       ->  GPIO24 (Pin 18)
DC          ->  GPIO25 (Pin 22)
MOSI        ->  MOSI (Pin 19)
SCK         ->  SCLK (Pin 23)
LED         ->  3.3V (Pin 17)
MISO        ->  MISO (Pin 21)
```

## Installation Instructions

### On Raspberry Pi:

1. Enable SPI interface:
```bash
sudo raspi-config
# Navigate to "Interface Options" -> "SPI" -> Enable
```

2. Install system dependencies:
```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-pil python3-numpy
```

3. Install Python dependencies:
```bash
pip3 install -r requirements.txt
```

4. Set up the service:
```bash
sudo nano /etc/systemd/system/api-display.service
```

Add the following content:
```ini
[Unit]
Description=API Status Display
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/path/to/your/directory
ExecStart=/usr/bin/python3 display.py
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

5. Start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable api-display
sudo systemctl start api-display
```

### For Development (macOS/Linux):

1. Create a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run in development mode:
```bash
python3 display.py
```

## Troubleshooting

1. If the display shows nothing:
   - Check the wiring connections
   - Verify SPI is enabled: `ls -l /dev/spi*`
   - Check service status: `sudo systemctl status api-display`

2. If you see permission errors:
   - Add your user to the SPI group: `sudo usermod -a -G spi,gpio $USER`
   - Check file permissions: `sudo chown $USER:$USER display.py`

3. For development testing without hardware:
   - The script will show errors about missing hardware but will continue running
   - Monitor the logs for API and Redis status updates

## Logs

View the logs using:
```bash
sudo journalctl -u api-display -f
```

## Customization

You can modify the following in `display.py`:
- Color schemes in the `# Cyberpunk color palette` section
- Update intervals in the `time.sleep()` call
- Display rotation in the `rotation=90` parameter 
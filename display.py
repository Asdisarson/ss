#!/usr/bin/env python3

import time
import board
import digitalio
import psutil
import requests
import redis
from PIL import Image, ImageDraw, ImageFont
import adafruit_rgb_display.ili9341 as ili9341

# Configuration for CS and DC pins
cs_pin = digitalio.DigitalInOut(board.CE0)
dc_pin = digitalio.DigitalInOut(board.D25)
reset_pin = digitalio.DigitalInOut(board.D24)

# Config for display baudrate (default max is 24mhz)
BAUDRATE = 24000000

# Setup SPI bus using hardware SPI
spi = board.SPI()

# Create the display
disp = ili9341.ILI9341(
    spi,
    rotation=90,
    cs=cs_pin,
    dc=dc_pin,
    rst=reset_pin,
    baudrate=BAUDRATE,
)

# Create blank image for drawing
width = disp.width
height = disp.height
image = Image.new("RGB", (width, height))
draw = ImageDraw.Draw(image)

# Load a TTF font
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
except OSError:
    font = ImageFont.load_default()
    font_small = ImageFont.load_default()

# Colors
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)

def get_api_status():
    try:
        response = requests.get('http://localhost:3000/api/products', timeout=5)
        return response.status_code == 200
    except:
        return False

def get_redis_status():
    try:
        r = redis.Redis(host='localhost', port=6379, db=0)
        return r.ping()
    except:
        return False

def get_system_info():
    cpu = psutil.cpu_percent()
    memory = psutil.virtual_memory().percent
    disk = psutil.disk_usage('/').percent
    return cpu, memory, disk

def update_display():
    # Clear the image
    draw.rectangle((0, 0, width, height), fill=BLACK)

    # Get statuses
    api_status = get_api_status()
    redis_status = get_redis_status()
    cpu, memory, disk = get_system_info()

    # Draw title
    draw.text((10, 10), "Product Search API", font=font, fill=BLUE)
    
    # Draw status indicators
    y = 50
    draw.text((10, y), "API Status:", font=font_small, fill=WHITE)
    draw.text((120, y), "✓ Online" if api_status else "✗ Offline", 
              font=font_small, fill=GREEN if api_status else RED)
    
    y += 30
    draw.text((10, y), "Redis:", font=font_small, fill=WHITE)
    draw.text((120, y), "✓ Connected" if redis_status else "✗ Disconnected", 
              font=font_small, fill=GREEN if redis_status else RED)

    # Draw system metrics
    y += 40
    draw.text((10, y), "System Metrics:", font=font_small, fill=BLUE)
    
    y += 25
    draw.text((10, y), f"CPU: {cpu}%", font=font_small, fill=WHITE)
    
    y += 25
    draw.text((10, y), f"Memory: {memory}%", font=font_small, fill=WHITE)
    
    y += 25
    draw.text((10, y), f"Disk: {disk}%", font=font_small, fill=WHITE)

    # Display time
    current_time = time.strftime("%H:%M:%S")
    draw.text((10, height - 30), current_time, font=font_small, fill=WHITE)

    # Display the image
    disp.image(image)

def main():
    print("Starting API status display...")
    while True:
        try:
            update_display()
        except Exception as e:
            print(f"Error updating display: {e}")
        time.sleep(1)

if __name__ == "__main__":
    main() 